#!/usr/bin/env node
/**
 * Continue.dev 桥接服务
 *
 * 用途：让 VSCodium + Continue.dev 能够按“当前项目”动态挂载 workspace-app 工作区。
 *
 * 设计：
 *   - 本服务只负责转发，本身不跑 LLM、不持有对话状态。
 *   - 启动时通过环境变量 WORKSPACE_APP_PATH 或当前 cwd 确定项目目录。
 *   - 收到 Continue 的 OpenAI 兼容请求后，把 workspacePath 注入到 upstream URL 查询参数，
 *     再转发给 workspace-app（默认 localhost:3002）。
 *   - 这样 workspace-app  remains通用；Continue 相关的适配隔离在本脚本里。
 *
 * 启动：
 *   node scripts/continue-bridge.mjs
 *   WORKSPACE_APP_PATH=/path/to/project node scripts/continue-bridge.mjs
 *   PORT=3003 WORKSPACE_APP_PATH=$(pwd) node scripts/continue-bridge.mjs
 *
 * Continue 配置：
 *   models:
 *     - name: XingSeq
 *       provider: openai
 *       model: xingseq
 *       apiBase: http://localhost:3003/v1
 *       apiKey: xingseq
 */

import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { URL, fileURLToPath } from 'node:url'

const PORT = parseInt(process.env.PORT || '3003', 10)
const UPSTREAM = process.env.CONTINUE_BRIDGE_UPSTREAM || 'http://localhost:3002'
const WORKSPACE_PATH = process.env.WORKSPACE_APP_PATH || process.cwd()
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const AUTO_START_WS_SERVER = ['localhost', '127.0.0.1'].includes(new URL(UPSTREAM).hostname)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS
  })
  res.end(JSON.stringify(data))
}

function log(...args) {
  console.log('[continue-bridge]', ...args)
}

function error(...args) {
  console.error('[continue-bridge]', ...args)
}

function resolveUpstreamUrl(pathname) {
  const url = new URL(pathname, UPSTREAM)
  url.searchParams.set('workspacePath', WORKSPACE_PATH)
  return url
}

function forward(req, res, pathname) {
  const upstreamUrl = resolveUpstreamUrl(pathname)
  const headers = { ...req.headers, host: upstreamUrl.host }

  const proxyReq = http.request(
    upstreamUrl,
    { method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        ...CORS_HEADERS
      })
      proxyRes.pipe(res)
    }
  )

  proxyReq.on('error', (err) => {
    error('upstream error:', err.message)
    if (!res.headersSent) {
      sendJSON(res, 502, { error: `upstream error: ${err.message}` })
    }
  })

  req.pipe(proxyReq)
}

function checkUpstreamHealth() {
  return new Promise((resolve) => {
    const url = new URL('/api/health', UPSTREAM)
    const req = http.get(url, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 300)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

function waitForUpstream(timeoutMs = 30000) {
  const interval = 500
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const tick = async () => {
      if (await checkUpstreamHealth()) return resolve()
      if (Date.now() >= deadline) return reject(new Error('等待 ws-server 启动超时'))
      setTimeout(tick, interval)
    }
    tick()
  })
}

function startWsServer() {
  return new Promise((resolve, reject) => {
    log('upstream 未就绪，正在启动 ws-server...')
    const proc = spawn('npm', ['run', 'server', '-w', 'apps/workspace-app'], {
      cwd: REPO_ROOT,
      stdio: 'inherit'
    })
    let settled = false
    const cleanup = () => { if (!settled) { settled = true; proc.kill() } }

    proc.on('error', (err) => {
      if (!settled) { settled = true; reject(err) }
    })
    proc.on('exit', (code) => {
      if (!settled) {
        settled = true
        reject(new Error(`ws-server 退出，code=${code}`))
      }
    })

    waitForUpstream(30000)
      .then(() => {
        if (!settled) { settled = true; resolve() }
      })
      .catch((err) => {
        cleanup()
        reject(err)
      })
  })
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    return res.end()
  }

  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname

  if (req.method === 'GET' && pathname === '/v1/models') {
    return forward(req, res, '/v1/models')
  }

  if (req.method === 'POST' && pathname === '/v1/chat/completions') {
    return forward(req, res, '/v1/chat/completions')
  }

  sendJSON(res, 404, { error: 'Not Found', path: pathname })
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    error(`端口 ${PORT} 已被占用，请先停止之前的 continue-bridge：`)
    error(`  lsof -ti:${PORT} | xargs kill`)
  } else {
    error('server error:', err.message)
  }
  process.exit(1)
})

async function main() {
  if (AUTO_START_WS_SERVER) {
    const healthy = await checkUpstreamHealth()
    if (healthy) {
      log('upstream 已就绪')
    } else {
      await startWsServer()
    }
  }

  server.listen(PORT, () => {
    log(`listening on http://localhost:${PORT}`)
    log(`upstream: ${UPSTREAM}`)
    log(`workspace: ${WORKSPACE_PATH}`)
    if (!path.isAbsolute(WORKSPACE_PATH)) {
      error('警告：workspace 路径不是绝对路径，workspace-app 会拒绝挂载。')
    }
  })
}

main().catch((err) => {
  error('启动失败:', err.message)
  process.exit(1)
})
