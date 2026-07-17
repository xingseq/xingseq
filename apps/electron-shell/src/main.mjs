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
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { promises as fsp } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// 子应用日志经 process.stdout/stderr 转发给控制台。当读端关闭
// （启动终端被关闭，或输出被 head/管道等命令截断）后继续写入会抛出
// EPIPE；若无处理会成为 uncaughtException 直接崩溃主进程，导致后续
// 子应用无法启动。此处静默忽略 EPIPE，其它错误一并吞掉（无可靠上报通道）。
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => {})
}

// apps/ 目录（本包位于 apps/electron-shell/src）
const appsDir = path.resolve(__dirname, '..', '..')
const webDistDir = path.resolve(__dirname, '..', 'web', 'dist')

// 用户安装目录：应用商店（skill-host）安装的子应用落在此处，
// 与内置 apps/ 分离，避免污染仓库工作区。与 skill-host 默认路径一致。
const projectsDir = path.join(
  os.homedir(), 'Library', 'Application Support', 'xingseq', 'projects'
)

const CONSOLE_PORT = parseInt(process.env.CONSOLE_PORT || '5180', 10)

let gatewayServer = null
let mainWindow = null
let skillHost = null   // 懒加载的 SkillHost 实例

/** 子应用注册表：name → { manifest, rootPath, source } */
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
 * 加载子应用注册表：合并两个来源：
 *   1. 内置应用（appsDir，monorepo 自带）—— source: 'builtin'
 *   2. 已安装应用（projectsDir，应用商店安装）—— source: 'installed'
 * 名称冲突时内置优先（跳过同名 installed，防止远程覆盖内置）。
 * 若两者均为空，回退到 FALLBACK_APPS。
 */
async function loadRegistry() {
  registry.clear()
  try {
    const { discoverSubApps } = await import('@xingseq/subapp-host')

    // 1. 内置应用
    const builtin = await discoverSubApps(appsDir)
    for (const { manifest, rootPath } of builtin) {
      registry.set(manifest.name, { manifest, rootPath, source: 'builtin' })
    }

    // 2. 已安装应用（内置优先，不覆盖）
    const installed = await discoverSubApps(projectsDir)
    for (const { manifest, rootPath } of installed) {
      if (registry.has(manifest.name)) {
        console.warn(`[console] 已安装应用 ${manifest.name} 与内置同名，已跳过`)
        continue
      }
      registry.set(manifest.name, { manifest, rootPath, source: 'installed' })
    }

    if (registry.size > 0) {
      console.log(`[console] 发现 ${registry.size} 个子应用 (内置 ${builtin.length} / 已安装 ${installed.length}): ${[...registry.keys()].join(', ')}`)
      return
    }
    console.warn('[console] 未发现任何 sub-app-manifest.json，使用兜底清单')
  } catch (err) {
    console.warn(`[console] subapp-host 加载失败，使用兜底清单: ${err.message}`)
  }
  for (const manifest of FALLBACK_APPS) {
    registry.set(manifest.name, { manifest, rootPath: path.join(appsDir, manifest.name), source: 'builtin' })
  }
}

/** 懒加载 SkillHost 实例（首次访问 store 端点时创建） */
async function getSkillHost() {
  if (skillHost) return skillHost
  const { createSkillHost } = await import('@xingseq/skill-host')
  skillHost = createSkillHost({ projectsDir })
  return skillHost
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
 * 启动单个 server（UI 或 API）。
 * 通用逻辑：探测端口 → 已就绪则采纳 → 否则 spawn 进程 → 等待健康。
 * @param {object} entry   registry entry { manifest, rootPath, source }
 * @param {'ui'|'api'} section
 * @param {string} name    子应用名称（日志标签用）
 * @returns {Promise<{ ok: boolean, port?: number, proc?: object|null, external?: boolean, error?: string, skipped?: boolean }>}
 */
async function startOneServer(entry, section, name) {
  const conf = entry.manifest[section]
  if (!conf || conf.enabled === false || !conf.port) {
    return { ok: true, skipped: true }
  }

  const port = conf.port
  const healthPath = conf.healthPath || '/api/health'

  // 端口已被外部占用且健康 → 直接采纳，不重复 spawn
  if (await probeHealth(port, healthPath)) {
    return { ok: true, port, external: true }
  }

  const portEnv = conf.portEnv || 'PORT'
  const childEnv = {
    ...process.env,
    [portEnv]: String(port),
    NODE_ENV: process.env.NODE_ENV || 'production',
    // Electron 可执行文件以纯 Node.js 模式运行子应用 server，
    // 避免每个子进程在 macOS Dock 上产生额外图标
    ELECTRON_RUN_AS_NODE: '1'
  }

  // 兼容两套启动约定：
  //   1. startCommand 声明启动命令（如 `npm run subapp` / `make run`），经 shell 执行。
  //   2. ui.server 指向 Node 脚本（默认 src/server.mjs），直接以 Electron(AS_NODE) 运行。
  let proc
  if (conf.startCommand) {
    proc = spawn(conf.startCommand, {
      cwd: entry.rootPath,
      env: childEnv,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } else if (section === 'ui') {
    const serverRel = conf.server || 'src/server.mjs'
    const serverPath = path.join(entry.rootPath, serverRel)
    proc = spawn(process.execPath, [serverPath], {
      cwd: entry.rootPath,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } else {
    return { ok: false, error: `${name} ${section} 未声明 startCommand 或 server` }
  }

  const tag = section === 'api' ? `${name}:api` : name
  // try/catch 兜底同步抛出的 EPIPE，配合顶部的 stream 'error' 监听覆盖异步错误
  proc.stdout.on('data', d => { try { process.stdout.write(`[${tag}] ${d}`) } catch {} })
  proc.stderr.on('data', d => { try { process.stderr.write(`[${tag}] ${d}`) } catch {} })
  proc.on('exit', (code) => {
    console.log(`[console] ${tag} 退出 (code=${code})`)
  })

  const ready = await waitForHealth(port, healthPath)
  if (!ready) {
    try { proc.kill() } catch {}
    return { ok: false, error: `${name} ${section} 启动超时（端口 ${port}）` }
  }
  return { ok: true, port, proc, external: false }
}

/**
 * 按需启动某个子应用 server（UI + 可选 API 后端）
 * @returns {Promise<{ ok: boolean, port?: number, error?: string }>}
 */
async function startSubApp(name) {
  const entry = registry.get(name)
  if (!entry) return { ok: false, error: `未找到子应用: ${name}` }

  const manifest = entry.manifest
  const hasUi = manifest.ui && manifest.ui.enabled !== false && manifest.ui.port
  const hasApi = manifest.api && manifest.api.enabled !== false && manifest.api.port

  if (!hasUi && !hasApi) {
    return { ok: false, error: `${name} 未声明可启动的 UI 或 API server` }
  }

  // 已在运行 → 逐端口探测健康，全部通过则直接返回
  if (running.has(name)) {
    const r = running.get(name)
    let allHealthy = !!(r.ui || r.api)
    if (r.ui) {
      const hp = manifest.ui.healthPath || '/api/health'
      if (!(await probeHealth(r.ui.port, hp))) allHealthy = false
    }
    if (r.api) {
      const hp = (manifest.api && manifest.api.healthPath) || '/api/health'
      if (!(await probeHealth(r.api.port, hp))) allHealthy = false
    }
    if (allHealthy) return { ok: true, port: r.ui?.port }
    running.delete(name)  // 部分进程已死，清理后重启
  }

  const record = { ui: null, api: null, cwd: entry.rootPath }

  // 先启动 API 后端（UI 通常代理到 API，后端需先就绪）
  if (hasApi) {
    const apiResult = await startOneServer(entry, 'api', name)
    if (!apiResult.ok) return apiResult
    record.api = {
      proc: apiResult.proc || null,
      port: apiResult.port,
      external: apiResult.external || false,
      stopCommand: manifest.api.stopCommand
    }
  }

  // 再启动 UI server
  if (hasUi) {
    const uiResult = await startOneServer(entry, 'ui', name)
    if (!uiResult.ok) {
      // UI 启动失败时清理已启动的 API 进程
      if (record.api && !record.api.external && record.api.proc) {
        try { record.api.proc.kill() } catch {}
      }
      return uiResult
    }
    record.ui = {
      proc: uiResult.proc || null,
      port: uiResult.port,
      external: uiResult.external || false,
      stopCommand: manifest.ui.stopCommand
    }
  }

  running.set(name, record)
  return { ok: true, port: record.ui?.port }
}

/** 停止某个子应用 server（外部采纳的进程不 kill） */
function stopSubApp(name) {
  const r = running.get(name)
  if (!r) return { ok: true, stopped: false }

  // 逐 section 清理：UI + API
  for (const section of ['ui', 'api']) {
    const s = r[section]
    if (!s || s.external) continue
    // 经 shell/startCommand 启动的进程，直接 kill 父进程可能残留子进程，
    // 优先执行 manifest 声明的 stopCommand（如 `npm run subapp:stop`）可靠回收。
    if (s.stopCommand) {
      try {
        spawn(s.stopCommand, {
          cwd: r.cwd, env: process.env, shell: true, stdio: 'ignore'
        })
      } catch {}
    }
    if (s.proc) {
      try { s.proc.kill() } catch {}
    }
  }

  running.delete(name)
  return { ok: true, stopped: true }
}

/** 组装 /console/api/apps 返回体 */
function listApps() {
  return [...registry.values()].map(({ manifest, source }) => {
    const ui = manifest.ui
    return {
      name: manifest.name,
      displayName: manifest.displayName || manifest.name,
      description: manifest.description || '',
      version: manifest.version || '',
      source: source || 'builtin',
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

// ── SSE 辅助（与 workspace-app 写法一致）───────────────────────────────────
function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  })
  res.write(': ok\n\n')
}

function sseSend(res, event, data) {
  if (res.writableEnded) return
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
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

/**
 * 以 SSE 流式执行安装/更新，把 installer 的 onProgress 实时推送给前端。
 * 成功后重新加载注册表，使新应用进入列表。
 * @param {import('node:http').ServerResponse} res
 * @param {'install'|'update'} action
 * @param {string} name
 */
async function runStoreInstallSSE(res, action, name) {
  sseInit(res)
  const onProgress = (step, message, detail) => {
    sseSend(res, 'progress', { step, message, detail })
  }
  try {
    const host = await getSkillHost()
    const result = action === 'update'
      ? await host.update(name, onProgress)
      : await host.install(name, onProgress)
    if (result.success) await loadRegistry()
    sseSend(res, 'done', result)
  } catch (err) {
    sseSend(res, 'done', { success: false, name, error: err.message })
  } finally {
    if (!res.writableEnded) res.end()
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

  // ── 应用商店（skill-host）─────────────────────────────────────
  // GET /console/api/store/apps — 远程+本地合并可用列表
  if (method === 'GET' && pathname === '/console/api/store/apps') {
    try {
      const host = await getSkillHost()
      const apps = await host.listAvailable()
      return sendJSON(res, 200, { apps })
    } catch (err) {
      // 远程拉取失败不算服务错误，返回空列表 + 错误提示
      return sendJSON(res, 200, { apps: [], error: err.message })
    }
  }

  // GET /console/api/store/updates — 可更新列表
  if (method === 'GET' && pathname === '/console/api/store/updates') {
    try {
      const host = await getSkillHost()
      const updates = await host.checkUpdates()
      return sendJSON(res, 200, { updates })
    } catch (err) {
      return sendJSON(res, 200, { updates: [], error: err.message })
    }
  }

  // GET /console/api/store/install/:name | /update/:name （SSE）
  const sm = pathname.match(/^\/console\/api\/store\/(install|update)\/([^/]+)$/)
  if (method === 'GET' && sm) {
    const action = sm[1]
    const name = decodeURIComponent(sm[2])
    return runStoreInstallSSE(res, action, name)
  }

  // POST /console/api/store/uninstall/:name
  const um = pathname.match(/^\/console\/api\/store\/uninstall\/([^/]+)$/)
  if (method === 'POST' && um) {
    const name = decodeURIComponent(um[1])
    try {
      const host = await getSkillHost()
      const result = await host.uninstall(name)
      if (result.success) await loadRegistry()
      return sendJSON(res, result.success ? 200 : 500, result)
    } catch (err) {
      return sendJSON(res, 500, { success: false, name, error: err.message })
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
