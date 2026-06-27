#!/usr/bin/env node
/**
 * workspace-app HTTP 服务
 *
 * 设计要点：
 *   - Node 原生 http，无 Express 依赖
 *   - SSE 流式推送 LLM 输出 + 工具调用过程
 *   - 支持绝对路径工作区挂载
 *   - 默认启用写工具（fs/shell），配合四层安全确认
 *   - 端口 3002（与 chat-app 的 3001 共存）
 *
 * 接口：
 *   GET  /api/health
 *   GET  /api/workspaces                          所有 workspace 列表
 *   GET  /api/conversations?workspace=xxx         workspace 内对话索引
 *   GET  /api/conversation/:id?workspace=xxx      加载某条对话
 *   POST /api/conversation/new?workspace=xxx      新建空对话 → { id, title }
 *   DELETE /api/conversation/:id?workspace=xxx    删除对话
 *   POST /api/chat?workspace=xxx                  SSE 流式对话
 *   POST /api/confirm                             确认/拒绝敏感操作
 *   GET  /api/files?path=&workspace=xxx           文件树
 *   GET  /api/file?path=&workspace=xxx            读取单个文件
 *
 * 启动：
 *   node src/server.mjs                           # 默认端口 3002
 *   PORT=4000 node src/server.mjs                 # 自定义端口
 *   WORKSPACE_APP_PATH=/path/to/project node src/server.mjs  # 挂载目录
 */

import { setSharedEnv } from '@xingseq/shared-utils/env'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { URL } from 'node:url'

// ===== 1. 注入 shared env =====
const userData = path.join(os.homedir(), '.xingseq', 'workspace-app')
fs.mkdirSync(userData, { recursive: true })

setSharedEnv({
  isCLI: true,
  importers: {
    cliLogger: () => import('electron-log/node.js').catch(() => ({ default: console }))
  },
  getApp: () => ({
    getPath: () => userData,
    isReady: () => true,
    whenReady: async () => {}
  }),
  systemModelsPath: null
})

// ===== 2. 业务模块 import =====
const { createWorkspaceRegistry, createWorkspaceStore } = await import('@xingseq/chat-core')
const { createConfirmationManager } = await import('@xingseq/tool-registry')
const { createProvider, resolveProviderType } = await import('./provider.mjs')
const { resolveWorkspace, ensureWorkspace, listWorkspaces, saveMountMeta } = await import('./workspace.mjs')

// ===== 3. 会话缓存 =====
const sessionCache = new Map()
const confirmManagers = new Map()

/**
 * @returns {Promise<import('@xingseq/chat-core').IChatProvider>}
 */
async function getOrCreateSession(workspaceName, conversationId, wsOpts = {}) {
  const key = `${workspaceName}::${conversationId}`
  if (sessionCache.has(key)) return sessionCache.get(key)

  const ws = resolveWorkspace(wsOpts)
  await ensureWorkspace(ws)
  if (ws.mounted) await saveMountMeta(ws)

  const registry = await createWorkspaceRegistry({
    workspace: ws,
    enableFs: true,
    enableShell: true,
    enableWeb: true,
    enableEmail: false
  })

  /** @type {import('@xingseq/chat-core').IChatProvider} */
  const session = createProvider({
    id: conversationId,
    workspace: ws,
    registry
  })
  await session.load().catch(() => null)
  sessionCache.set(key, session)
  return session
}

// ===== 4. HTTP 工具函数 =====
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sendJSON(res, status, data) {
  setCORS(res)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8')
      if (!text) return resolve({})
      try { resolve(JSON.parse(text)) }
      catch (e) { reject(new Error('请求体不是合法 JSON')) }
    })
    req.on('error', reject)
  })
}

function sseInit(res) {
  setCORS(res)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.write(': ok\n\n')
}

function sseSend(res, event, data) {
  if (res.writableEnded) return
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

/**
 * 从 URL params 解析 workspace 选项
 */
function parseWsOpts(url) {
  const workspace = url.searchParams.get('workspace') || undefined
  const workspacePath = url.searchParams.get('workspacePath') || undefined
  return { workspace, workspacePath }
}

/**
 * 获取当前 workspace 的 display name
 */
function wsDisplayName(url) {
  const opts = parseWsOpts(url)
  return opts.workspacePath
    ? path.basename(opts.workspacePath)
    : (opts.workspace || 'default')
}

// ===== 5. 路由 =====
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname
  const method = req.method

  // CORS 预检
  if (method === 'OPTIONS') {
    setCORS(res)
    res.writeHead(204)
    return res.end()
  }

  // health
  if (method === 'GET' && pathname === '/api/health') {
    return sendJSON(res, 200, { ok: true, ts: Date.now() })
  }

  // workspaces
  if (method === 'GET' && pathname === '/api/workspaces') {
    const list = await listWorkspaces()
    return sendJSON(res, 200, {
      workspaces: list.map(w => ({ name: w.name, root: w.root, mounted: w.mounted }))
    })
  }

  // POST /api/workspace/mount  挂载任意绝对路径为工作区
  if (method === 'POST' && pathname === '/api/workspace/mount') {
    const body = await readBody(req).catch(() => ({}))
    const mountPath = body.path || body.workspacePath
    if (!mountPath) {
      return sendJSON(res, 400, { error: '缺少 path 参数' })
    }
    if (!path.isAbsolute(mountPath)) {
      return sendJSON(res, 400, { error: `path 必须是绝对路径: "${mountPath}"` })
    }
    try {
      const ws = resolveWorkspace({ workspacePath: mountPath })
      await ensureWorkspace(ws)
      await saveMountMeta(ws)
      return sendJSON(res, 200, {
        workspace: { name: ws.name, root: ws.root, filesDir: ws.filesDir, mounted: true }
      })
    } catch (err) {
      return sendJSON(res, 400, { error: err.message })
    }
  }

  // files tree
  if (method === 'GET' && pathname === '/api/files') {
    const wsOpts = parseWsOpts(url)
    const ws = resolveWorkspace(wsOpts)
    await ensureWorkspace(ws)
    const relPath = url.searchParams.get('path') || '.'
    const absPath = path.resolve(ws.filesDir, relPath)

    // 安全校验：不能越权
    if (!absPath.startsWith(ws.filesDir)) {
      return sendJSON(res, 403, { error: '路径越权' })
    }

    try {
      const entries = await fsp.readdir(absPath, { withFileTypes: true })
      const items = entries
        .filter(e => !e.name.startsWith('.'))
        .map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
          path: path.relative(ws.filesDir, path.join(absPath, e.name))
        }))
      return sendJSON(res, 200, { path: relPath, items })
    } catch (e) {
      return sendJSON(res, 404, { error: e.message })
    }
  }

  // file content
  if (method === 'GET' && pathname === '/api/file') {
    const wsOpts = parseWsOpts(url)
    const ws = resolveWorkspace(wsOpts)
    await ensureWorkspace(ws)
    const relPath = url.searchParams.get('path') || ''
    const absPath = path.resolve(ws.filesDir, relPath)

    if (!absPath.startsWith(ws.filesDir)) {
      return sendJSON(res, 403, { error: '路径越权' })
    }

    try {
      const stat = await fsp.stat(absPath)
      if (stat.size > 64 * 1024) {
        return sendJSON(res, 413, { error: '文件超过 64KB 限制' })
      }
      const content = await fsp.readFile(absPath, 'utf-8')
      return sendJSON(res, 200, { path: relPath, content, size: stat.size })
    } catch (e) {
      return sendJSON(res, 404, { error: e.message })
    }
  }

  // conversations
  if (method === 'GET' && pathname === '/api/conversations') {
    const wsOpts = parseWsOpts(url)
    const ws = resolveWorkspace(wsOpts)
    await ensureWorkspace(ws)
    const store = createWorkspaceStore(ws.memoryDir)
    const list = await store.listConversations({ limit: 100 })
    return sendJSON(res, 200, { workspace: ws.name, conversations: list })
  }

  // GET/DELETE /api/conversation/:id
  const convMatch = pathname.match(/^\/api\/conversation\/([^/]+)$/)
  if (convMatch) {
    const id = decodeURIComponent(convMatch[1])
    const wsOpts = parseWsOpts(url)
    const ws = resolveWorkspace(wsOpts)
    await ensureWorkspace(ws)
    const store = createWorkspaceStore(ws.memoryDir)
    if (method === 'GET') {
      const r = await store.loadConversation(id)
      if (!r.success) return sendJSON(res, 404, r)
      return sendJSON(res, 200, r.data)
    }
    if (method === 'DELETE') {
      sessionCache.delete(`${ws.name}::${id}`)
      const r = await store.deleteConversation(id)
      return sendJSON(res, 200, r)
    }
  }

  // POST /api/conversation/new
  if (method === 'POST' && pathname === '/api/conversation/new') {
    const wsOpts = parseWsOpts(url)
    const ws = resolveWorkspace(wsOpts)
    const body = await readBody(req).catch(() => ({}))
    const id = `ws-${Date.now()}`
    const title = body.title || `工作区对话 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
    const session = await getOrCreateSession(ws.name, id, wsOpts)
    session.title = title
    await session.save().catch(() => null)
    return sendJSON(res, 200, { id, title, workspace: ws.name })
  }

  // POST /api/chat (SSE)
  if (method === 'POST' && pathname === '/api/chat') {
    const wsOpts = parseWsOpts(url)
    const ws = resolveWorkspace(wsOpts)
    const body = await readBody(req).catch(e => ({ __error: e.message }))
    if (body.__error) return sendJSON(res, 400, { error: body.__error })
    const { conversationId, message } = body
    if (!conversationId || !message) {
      return sendJSON(res, 400, { error: '缺少 conversationId 或 message' })
    }

    sseInit(res)

    let session
    try {
      session = await getOrCreateSession(ws.name, conversationId, wsOpts)
    } catch (err) {
      sseSend(res, 'error', { message: err.message })
      return res.end()
    }

    // 独立确认管理器（30s 倒计时）
    const localManager = createConfirmationManager({
      isCLI: false,
      countdownConfigReader: async () => ({
        enabled: true,
        seconds: 30,
        applyToTools: [
          'set_file_content',
          'replace_file_string',
          'copy_file',
          'move_file',
          'execute_command',
          'launch_application',
          'delete_file',
          'create_directory'
        ]
      }),
      sendFrontendConfirm: async (payload) => {
        confirmManagers.set(payload.confirmId, localManager)
        sseSend(res, 'confirm_request', payload)
      },
      sensitiveTools: [
        'set_file_content',
        'replace_file_string',
        'copy_file',
        'move_file',
        'execute_command',
        'launch_application',
        'delete_file',
        'create_directory'
      ]
    })

    // 心跳
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': hb\n\n')
    }, 15000)
    req.on('close', () => clearInterval(heartbeat))

    try {
      const result = await session.chat(message, {
        confirmation: localManager,
        onChunk: (chunk) => sseSend(res, 'chunk', chunk),
        onToolCall: (tc) => {
          let argsObj = null
          try {
            argsObj = typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : (tc.function?.arguments || tc.args || tc.arguments || null)
          } catch { argsObj = tc.function?.arguments }
          sseSend(res, 'tool_call', {
            id: tc.id,
            name: tc.function?.name || tc.name,
            args: argsObj
          })
        },
        onToolResult: (tc, result, error) => {
          sseSend(res, 'tool_result', {
            id: tc.id,
            name: tc.function?.name || tc.name,
            result: error ? null : result,
            error: error ? error.message : null
          })
        },
        onToolDenied: (tc) => {
          sseSend(res, 'tool_denied', {
            id: tc.id,
            name: tc.function?.name || tc.name
          })
        }
      })

      await session.save().catch(() => null)

      sseSend(res, 'done', {
        conversationId,
        success: !!result.success,
        depth: result.depth,
        error: result.error || null,
        messages: session.messages
      })
    } catch (err) {
      sseSend(res, 'error', { message: err.message })
    } finally {
      clearInterval(heartbeat)
      res.end()
    }
    return
  }

  // POST /api/confirm
  if (method === 'POST' && pathname === '/api/confirm') {
    const body = await readBody(req).catch(() => ({}))
    const { confirmId, confirmed } = body
    if (!confirmId || typeof confirmed !== 'boolean') {
      return sendJSON(res, 400, { error: '缺少 confirmId 或 confirmed' })
    }
    const mgr = confirmManagers.get(confirmId)
    if (!mgr) {
      return sendJSON(res, 404, { error: '未找到对应的 confirmId（可能已超时或已处理）' })
    }
    const ok = mgr.resolvePendingConfirm(confirmId, confirmed)
    confirmManagers.delete(confirmId)
    return sendJSON(res, 200, { ok, confirmId, confirmed })
  }

  // 404
  sendJSON(res, 404, { error: 'Not Found', path: pathname })
}

// ===== 6. 启动 =====
const PORT = parseInt(process.env.PORT || '3002', 10)

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res)
  } catch (err) {
    console.error('[workspace-app server] 未捕获错误:', err)
    if (!res.writableEnded) {
      try { sendJSON(res, 500, { error: err.message || String(err) }) } catch {}
    }
  }
})

server.listen(PORT, () => {
  console.log(`[workspace-app server] http://localhost:${PORT}`)
  console.log(`  provider: ${resolveProviderType()}`)
  console.log(`  userData: ${userData}`)
  console.log(`  health:   http://localhost:${PORT}/api/health`)
  if (process.env.WORKSPACE_APP_PATH) {
    console.log(`  mounted:  ${process.env.WORKSPACE_APP_PATH}`)
  }
})
