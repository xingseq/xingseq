#!/usr/bin/env node
/**
 * chat-app HTTP 服务（最小前端的后端）
 *
 * 设计要点：
 *   - Node 原生 http，无 Express 等额外依赖
 *   - SSE 流式推送 LLM 输出 + 工具调用过程，前端可秒级感知
 *   - 复用 chatSession / workspace / workspaceStore，与 CLI 共用核心逻辑
 *   - 多 workspace 共存：每个请求通过 ?workspace=xxx 选择
 *   - 会话缓存：同一 (workspace, conversationId) 的 chatSession 在内存复用
 *
 * 接口：
 *   GET  /api/health
 *   GET  /api/workspaces                          所有 workspace 列表
 *   GET  /api/conversations?workspace=xxx         workspace 内对话索引
 *   GET  /api/conversation/:id?workspace=xxx      加载某条对话
 *   POST /api/conversation/new?workspace=xxx      新建空对话 → { id, title }
 *   DELETE /api/conversation/:id?workspace=xxx    删除对话
 *   POST /api/chat?workspace=xxx                  SSE 流式对话
 *        body: { conversationId, message }
 *        events: chunk / tool_call / tool_result / done / error
 *
 * 启动：
 *   node src/server.mjs                  # 默认端口 3001
 *   PORT=4000 node src/server.mjs        # 自定义端口
 */

import { setSharedEnv } from '@xingseq/shared-utils/env'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { URL } from 'node:url'

// ===== 1. 注入 shared env（必须在 import 业务模块前） =====
const userData = path.join(os.homedir(), '.xingseq', 'chat-app')
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
// 对话能力走 IChatProvider 接口（createProvider），底层实现可运行时替换。
const {
  createWorkspaceRegistry,
  resolveWorkspace,
  ensureWorkspace,
  listWorkspaces,
  createWorkspaceStore
} = await import('@xingseq/chat-core')
const { createProvider, resolveProviderType } = await import('./provider.mjs')
const { createConfirmationManager } = await import('@xingseq/tool-registry')

// ===== 3. 会话缓存：key = `${workspaceName}::${conversationId}` =====
const sessionCache = new Map()

// confirmId → manager 映射，用于 POST /api/confirm 路由到正确的 manager.resolvePendingConfirm
const confirmManagers = new Map()

/**
 * 取/建一个 IChatProvider 实例（按 workspace + conversationId 缓存）
 *
 * @returns {Promise<import('@xingseq/chat-core').IChatProvider>}
 */
async function getOrCreateSession(workspaceName, conversationId) {
  const key = `${workspaceName}::${conversationId}`
  if (sessionCache.has(key)) return sessionCache.get(key)

  const ws = resolveWorkspace({ workspace: workspaceName })
  await ensureWorkspace(ws)
  const registry = await createWorkspaceRegistry({
    workspace: ws,
    enableEmail: true
  })
  // 这里只声明返回 IChatProvider；具体由 provider.mjs 决定走 chat-core 还是 agent。
  const session = createProvider({
    id: conversationId,
    workspace: ws,
    registry
  })
  // 尝试加载已有对话（不存在则忽略）
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
  // 立即 flush 一个注释，确保浏览器进入流模式
  res.write(': ok\n\n')
}

function sseSend(res, event, data) {
  if (res.writableEnded) return
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

// ===== 5. 路由 =====
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname
  const method = req.method
  const workspace = url.searchParams.get('workspace') || 'default'

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
    return sendJSON(res, 200, { workspaces: list.map(w => ({ name: w.name, root: w.root })) })
  }

  // conversations
  if (method === 'GET' && pathname === '/api/conversations') {
    const ws = resolveWorkspace({ workspace })
    await ensureWorkspace(ws)
    const store = createWorkspaceStore(ws.memoryDir)
    const list = await store.listConversations({ limit: 100 })
    return sendJSON(res, 200, { workspace, conversations: list })
  }

  // GET /api/conversation/:id
  const convMatch = pathname.match(/^\/api\/conversation\/([^/]+)$/)
  if (convMatch) {
    const id = decodeURIComponent(convMatch[1])
    const ws = resolveWorkspace({ workspace })
    await ensureWorkspace(ws)
    const store = createWorkspaceStore(ws.memoryDir)
    if (method === 'GET') {
      const r = await store.loadConversation(id)
      if (!r.success) return sendJSON(res, 404, r)
      return sendJSON(res, 200, r.data)
    }
    if (method === 'DELETE') {
      // 同时清缓存
      sessionCache.delete(`${workspace}::${id}`)
      const r = await store.deleteConversation(id)
      return sendJSON(res, 200, r)
    }
  }

  // POST /api/conversation/new
  if (method === 'POST' && pathname === '/api/conversation/new') {
    const body = await readBody(req).catch(() => ({}))
    const id = `chat-${Date.now()}`
    const title = body.title || `对话 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
    const session = await getOrCreateSession(workspace, id)
    session.title = title
    // 先写一次空索引，避免列表里看不到
    await session.save().catch(() => null)
    return sendJSON(res, 200, { id, title, workspace })
  }

  // POST /api/chat (SSE)
  if (method === 'POST' && pathname === '/api/chat') {
    const body = await readBody(req).catch((e) => ({ __error: e.message }))
    if (body.__error) return sendJSON(res, 400, { error: body.__error })
    const { conversationId, message } = body
    if (!conversationId || !message) {
      return sendJSON(res, 400, { error: '缺少 conversationId 或 message' })
    }

    sseInit(res)

    let session
    try {
      session = await getOrCreateSession(workspace, conversationId)
    } catch (err) {
      sseSend(res, 'error', { message: err.message })
      return res.end()
    }

    // 为本次 SSE 连接创建独立的确认管理器
    // 默认 30s 倒计时；前端可提前点「立即执行」或「拒绝」
    const localManager = createConfirmationManager({
      isCLI: false,
      countdownConfigReader: async () => ({
        enabled: true,
        seconds: 30,
        applyToTools: [
          // 全部默认敏感工具都走倒计时确认模式
          'set_file_content',
          'replace_file_string',
          'copy_file',
          'move_file',
          'execute_command',
          'launch_application',
          'insert_record',
          'update_record',
          'delete_record',
          'create_table',
          'download_file',
          'delete_file'
        ]
      }),
      sendFrontendConfirm: async (payload) => {
        confirmManagers.set(payload.confirmId, localManager)
        sseSend(res, 'confirm_request', payload)
      },
      // 额外注册「delete_file」/「create_directory」为敏感工具
      sensitiveTools: [
        'set_file_content',
        'replace_file_string',
        'copy_file',
        'move_file',
        'execute_command',
        'launch_application',
        'insert_record',
        'update_record',
        'delete_record',
        'create_table',
        'download_file',
        'delete_file',
        'create_directory'
      ]
    })

    // 心跳：每 15s 一个注释，避免连接被中间网关掐
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': hb\n\n')
    }, 15000)

    // 客户端断开 → 清理（不影响 LLM 请求继续，LLM 完成后写入对话历史）
    req.on('close', () => clearInterval(heartbeat))

    try {
      const result = await session.chat(message, {
        confirmation: localManager,
        onChunk: (chunk) => {
          // chunk: { type: 'THINK'|'CONTENT'|'TOOL_CALL', content, done? }
          sseSend(res, 'chunk', chunk)
        },
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

      // 落盘
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

  // POST /api/confirm  body: { confirmId, confirmed }
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

  // ===== 静态文件（Web 前端 dist），供 iframe/直接访问同源加载 =====
  // 非 /api 的 GET 请求走这里，找不到则 SPA fallback 到 index.html。
  if (method === 'GET' && !pathname.startsWith('/api/')) {
    const distDir = path.resolve(import.meta.dirname, '..', 'web', 'dist')
    let filePath = path.join(distDir, pathname === '/' ? 'index.html' : decodeURIComponent(pathname))
    const mimeMap = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
    try {
      const stat = await fsp.stat(filePath)
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html')
      const content = await fsp.readFile(filePath)
      const ext = path.extname(filePath)
      setCORS(res)
      res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' })
      return res.end(content)
    } catch {
      // SPA fallback
      try {
        const html = await fsp.readFile(path.join(distDir, 'index.html'))
        res.writeHead(200, { 'Content-Type': 'text/html' })
        return res.end(html)
      } catch {
        return sendJSON(res, 404, { error: 'Web 前端未构建，请先执行 npm run web:build -w apps/chat-app' })
      }
    }
  }

  // 404
  sendJSON(res, 404, { error: 'Not Found', path: pathname })
}

// ===== 6. 启动 =====
const PORT = parseInt(process.env.PORT || '3001', 10)

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res)
  } catch (err) {
    console.error('[server] 未捕获错误:', err)
    if (!res.writableEnded) {
      try { sendJSON(res, 500, { error: err.message || String(err) }) } catch {}
    }
  }
})

server.listen(PORT, () => {
  console.log(`[chat-app server] http://localhost:${PORT}`)
  console.log(`  provider: ${resolveProviderType()}`)
  console.log(`  userData: ${userData}`)
  console.log(`  health:   http://localhost:${PORT}/api/health`)
})
