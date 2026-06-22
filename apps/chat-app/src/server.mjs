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
const { createChatSession, createWorkspaceRegistry } = await import('./chatSession.js')
const { resolveWorkspace, ensureWorkspace, listWorkspaces } = await import('./workspace.js')
const { createWorkspaceStore } = await import('./workspaceStore.js')

// ===== 3. 会话缓存：key = `${workspaceName}::${conversationId}` =====
const sessionCache = new Map()

async function getOrCreateSession(workspaceName, conversationId) {
  const key = `${workspaceName}::${conversationId}`
  if (sessionCache.has(key)) return sessionCache.get(key)

  const ws = resolveWorkspace({ workspace: workspaceName })
  await ensureWorkspace(ws)
  const registry = createWorkspaceRegistry({ workspace: ws })
  const session = createChatSession({
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

    // 心跳：每 15s 一个注释，避免连接被中间网关掐
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': hb\n\n')
    }, 15000)

    // 客户端断开 → 清理（不影响 LLM 请求继续，LLM 完成后写入对话历史）
    req.on('close', () => clearInterval(heartbeat))

    try {
      const result = await session.chat(message, {
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
  console.log(`  userData: ${userData}`)
  console.log(`  health:   http://localhost:${PORT}/api/health`)
})
