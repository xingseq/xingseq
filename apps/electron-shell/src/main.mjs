#!/usr/bin/env node
/**
 * @xingseq/electron-shell
 * Electron 主进程入口 —— XingSeq 综合控制台
 *
 * 职责：
 *   1. 启动控制台网关 http 服务（端口 5180）：
 *      - 服务控制台前端 electron-shell/web/dist 静态资源
 *      - /console/api/apps            通过 subapp-host 发现子应用 + 运行状态
 *      - /console/api/apps/:name/start 按需 spawn 子应用 server 并等待就绪
 *      - /console/api/apps/:name/stop  停止子应用 server
 *   2. 创建浏览器窗口加载控制台页面
 *
 * 架构：控制台不再固定绑定 workspace-app，而是发现 apps/ 下带
 *       sub-app-manifest.json 的所有子应用；每个子应用在自己的端口上
 *       提供完整 UI，控制台前端用 <iframe> 按端口嵌入。
 *
 * 用法：
 *   npm start -w apps/electron-shell
 */

import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { promises as fsp } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// apps/ 目录（本包位于 apps/electron-shell/src）
const appsDir = path.resolve(__dirname, '..', '..')
const webDistDir = path.resolve(__dirname, '..', 'web', 'dist')

const CONSOLE_PORT = parseInt(process.env.CONSOLE_PORT || '5180', 10)

let gatewayServer = null
let mainWindow = null

/** 子应用注册表：name → { manifest, rootPath } */
const registry = new Map()
/** 运行中的子应用进程：name → { proc, port, external } */
const running = new Map()

// ── 兜底静态清单（subapp-host 发现失败或无 manifest 时使用）─────────────────────
const FALLBACK_APPS = [
  {
    name: 'workspace-app', displayName: '工作区', version: '0.1.0',
    description: '挂载本地目录 + 文件树 + 对话 + Shell（四层安全确认）',
    ui: { enabled: true, port: 3002, portEnv: 'PORT', server: 'src/server.mjs', healthPath: '/api/health' },
    cli: { enabled: true }
  },
  {
    name: 'chat-app', displayName: '对话', version: '0.2.0',
    description: '交互式多轮对话 + 工具调用 + Web 搜索',
    ui: { enabled: true, port: 3001, portEnv: 'PORT', server: 'src/server.mjs', healthPath: '/api/health' },
    cli: { enabled: true }
  },
  {
    name: 'llm-manager', displayName: 'LLM 管理', version: '0.1.0',
    description: '全局模型配置 / API Key / 默认模型 / 连通性测试',
    ui: { enabled: true, port: 7820, portEnv: 'LLM_MANAGER_PORT', server: 'src/server.mjs', healthPath: '/api/models' },
    cli: { enabled: true }
  }
]

/**
 * 加载子应用注册表：优先用 subapp-host 扫描 apps/ 下的 manifest，
 * 若为空则回退到 FALLBACK_APPS（rootPath 按 apps/<name> 推导）。
 */
async function loadRegistry() {
  registry.clear()
  try {
    const { discoverSubApps } = await import('@xingseq/subapp-host')
    const discovered = await discoverSubApps(appsDir)
    for (const { manifest, rootPath } of discovered) {
      registry.set(manifest.name, { manifest, rootPath })
    }
    if (registry.size > 0) {
      console.log(`[console] subapp-host 发现 ${registry.size} 个子应用: ${[...registry.keys()].join(', ')}`)
      return
    }
    console.warn('[console] 未发现任何 sub-app-manifest.json，使用兜底清单')
  } catch (err) {
    console.warn(`[console] subapp-host 加载失败，使用兜底清单: ${err.message}`)
  }
  for (const manifest of FALLBACK_APPS) {
    registry.set(manifest.name, { manifest, rootPath: path.join(appsDir, manifest.name) })
  }
}

/** 探测某端口的 health 路径是否就绪 */
function probeHealth(port, healthPath) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: 'localhost', port, path: healthPath, timeout: 1500 }, (res) => {
      res.resume()
      resolve(res.statusCode >= 200 && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

/** 轮询等待就绪，最长约 15s */
async function waitForHealth(port, healthPath, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probeHealth(port, healthPath)) return true
    await new Promise(r => setTimeout(r, 300))
  }
  return false
}

/**
 * 按需启动某个子应用 server
 * @returns {Promise<{ ok: boolean, port?: number, error?: string }>}
 */
async function startSubApp(name) {
  const entry = registry.get(name)
  if (!entry) return { ok: false, error: `未找到子应用: ${name}` }

  const ui = entry.manifest.ui
  if (!ui || ui.enabled === false || !ui.port) {
    return { ok: false, error: `${name} 未声明可启动的 UI server` }
  }

  const port = ui.port
  const healthPath = ui.healthPath || '/api/health'

  // 已被本进程启动
  if (running.has(name)) {
    const ok = await probeHealth(port, healthPath)
    if (ok) return { ok: true, port }
    running.delete(name)  // 进程已死，清理后重启
  }

  // 端口已被外部占用且健康 → 直接采纳，不重复 spawn
  if (await probeHealth(port, healthPath)) {
    running.set(name, { proc: null, port, external: true })
    return { ok: true, port }
  }

  const serverRel = ui.server || 'src/server.mjs'
  const serverPath = path.join(entry.rootPath, serverRel)
  const portEnv = ui.portEnv || 'PORT'

  const proc = spawn(process.execPath, [serverPath], {
    cwd: entry.rootPath,
    env: { ...process.env, [portEnv]: String(port), NODE_ENV: process.env.NODE_ENV || 'production' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  proc.stdout.on('data', d => process.stdout.write(`[${name}] ${d}`))
  proc.stderr.on('data', d => process.stderr.write(`[${name}] ${d}`))
  proc.on('exit', (code) => {
    console.log(`[console] 子应用 ${name} 退出 (code=${code})`)
    running.delete(name)
  })

  running.set(name, { proc, port, external: false })

  const ready = await waitForHealth(port, healthPath)
  if (!ready) {
    stopSubApp(name)
    return { ok: false, error: `${name} 启动超时（端口 ${port}）` }
  }
  return { ok: true, port }
}

/** 停止某个子应用 server（外部采纳的进程不 kill） */
function stopSubApp(name) {
  const r = running.get(name)
  if (!r) return { ok: true, stopped: false }
  if (r.proc && !r.external) {
    try { r.proc.kill() } catch {}
  }
  running.delete(name)
  return { ok: true, stopped: true }
}

/** 组装 /console/api/apps 返回体 */
function listApps() {
  return [...registry.values()].map(({ manifest }) => {
    const ui = manifest.ui
    return {
      name: manifest.name,
      displayName: manifest.displayName || manifest.name,
      description: manifest.description || '',
      version: manifest.version || '',
      cli: !!(manifest.cli && manifest.cli.enabled),
      ui: ui && ui.enabled !== false && ui.port
        ? { enabled: true, port: ui.port }
        : null,
      running: running.has(manifest.name)
    }
  })
}

// ── 控制台网关 http 服务 ────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(JSON.stringify(data))
}

async function serveStatic(res, urlPath) {
  let filePath = path.join(webDistDir, urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath))
  try {
    const stat = await fsp.stat(filePath)
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html')
    const content = await fsp.readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
    res.end(content)
  } catch {
    // SPA fallback
    try {
      const html = await fsp.readFile(path.join(webDistDir, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('控制台前端未构建，请先执行 npm run web:build -w apps/electron-shell')
    }
  }
}

async function handleGateway(req, res) {
  const url = new URL(req.url, `http://localhost:${CONSOLE_PORT}`)
  const { pathname } = url
  const method = req.method

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    })
    return res.end()
  }

  // GET /console/api/apps
  if (method === 'GET' && pathname === '/console/api/apps') {
    return sendJSON(res, 200, { apps: listApps() })
  }

  // POST /console/api/apps/:name/start | /stop
  const m = pathname.match(/^\/console\/api\/apps\/([^/]+)\/(start|stop)$/)
  if (method === 'POST' && m) {
    const name = decodeURIComponent(m[1])
    if (m[2] === 'start') {
      const result = await startSubApp(name)
      return sendJSON(res, result.ok ? 200 : 500, result)
    } else {
      const result = stopSubApp(name)
      return sendJSON(res, 200, result)
    }
  }

  // 其余 → 静态资源
  if (method === 'GET' && !pathname.startsWith('/console/api/')) {
    return serveStatic(res, pathname)
  }

  sendJSON(res, 404, { error: 'Not Found', path: pathname })
}

function startGateway() {
  return new Promise((resolve, reject) => {
    gatewayServer = http.createServer((req, res) => {
      handleGateway(req, res).catch((err) => {
        if (!res.writableEnded) sendJSON(res, 500, { error: err.message })
      })
    })
    gatewayServer.on('error', reject)
    gatewayServer.listen(CONSOLE_PORT, () => {
      console.log(`[console] 网关已启动: http://localhost:${CONSOLE_PORT}`)
      resolve()
    })
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'XingSeq 控制台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.loadURL(`http://localhost:${CONSOLE_PORT}`)
  if (isDev) mainWindow.webContents.openDevTools()
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  try {
    await loadRegistry()
    console.log(`[console] starting gateway on ${CONSOLE_PORT}...`)
    await startGateway()
    console.log('[console] creating window...')
    createWindow()
  } catch (err) {
    console.error('[console] failed to start:', err)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

function cleanup() {
  for (const name of [...running.keys()]) stopSubApp(name)
  if (gatewayServer) { gatewayServer.close(); gatewayServer = null }
}

app.on('before-quit', cleanup)
process.on('SIGTERM', () => { cleanup(); app.quit() })
process.on('SIGINT', () => { cleanup(); app.quit() })
