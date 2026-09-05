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
 *      - /console/api/settings        控制台设置读写（console.json）
 *   2. 创建浏览器窗口加载控制台页面
 *
 * 设置体系（~/.xingseq/config/console.json，与 config-core 全局配置目录同体系）：
 *   - env 键在启动时注入 process.env（shell 已有环境变量优先，与
 *     .env.example 声明的优先级一致），spawn 的子应用自动继承；
 *   - autoStart[name] 覆盖 manifest.autoStart，商店更新不丢配置；
 *   - window.bounds 记忆窗口位置与尺寸。
 *
 * 架构：控制台不再固定绑定 workspace-app，而是发现 apps/ 下带
 *       sub-app-manifest.json 的所有子应用；每个子应用在自己的端口上
 *       提供完整 UI，控制台前端用 <iframe> 按端口嵌入。
 *
 * 用法：
 *   npm start -w apps/electron-shell
 */

import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
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

// ── 控制台设置（console.json）────────────────────────────────────────
// 固定于 ~/.xingseq/config/console.json（与 config-core 的全局配置目录同一体系，
// 不受 NAJIE_USER_DATA_PATH 影响，保证壳层永远能找到自己的配置）。
const SETTINGS_PATH = path.join(os.homedir(), '.xingseq', 'config', 'console.json')

// 本包版本（读 package.json，避免硬编码）
const pkgInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'))

// 设置页可管理的环境变量白名单（分组展示；CONSOLE_PORT 不在此列，
// 由 general.consolePort 单独管理）
const ENV_KEYS = {
  network: ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY'],
  paths: ['NAJIE_USER_DATA_PATH', 'CHAT_APP_WORKSPACE', 'WORKSPACE_APP_PATH', 'WORKSPACE_APP_WORKSPACE']
}
const ENV_KEY_WHITELIST = new Set([...ENV_KEYS.network, ...ENV_KEYS.paths])

const DEFAULT_SETTINGS = {
  version: 1,
  general: { openAtLogin: false, rememberWindow: true, consolePort: null },
  window: null,          // { bounds: {x,y,width,height}, maximized }
  env: {},               // 白名单键 → 值（空值不入盘）
  autoStart: {}          // name → bool，覆盖 manifest.autoStart
}

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      general: { ...DEFAULT_SETTINGS.general, ...(parsed.general || {}) },
      window: parsed.window || null,
      env: sanitizeEnv(parsed.env),
      autoStart: parsed.autoStart && typeof parsed.autoStart === 'object' ? parsed.autoStart : {}
    }
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  }
}

/** 过滤 env 组：仅保留白名单键与非空值 */
function sanitizeEnv(env) {
  const clean = {}
  if (!env || typeof env !== 'object') return clean
  for (const [k, v] of Object.entries(env)) {
    if (ENV_KEY_WHITELIST.has(k) && v !== '' && v != null) clean[k] = String(v)
  }
  return clean
}

/** 同步写盘：文件极小且写入频率低，同步写避开 quit 竞态 */
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
    return { ok: true }
  } catch (err) {
    console.warn(`[console] 保存设置失败: ${err.message}`)
    return { ok: false, error: err.message }
  }
}

let settings = loadSettings()

// 启动注入：shell 已有环境变量优先（与 .env.example 声明的优先级一致），
// console.json 只填空缺；改动在下一次启动生效。
// 记录注入集合，用于区分「文件注入生效」与「shell 环境变量原生提供」。
const injectedEnvKeys = new Set()
for (const [k, v] of Object.entries(settings.env)) {
  if (!(k in process.env)) {
    process.env[k] = v
    injectedEnvKeys.add(k)
  }
}

/** autoStart 生效值：壳层 override 优先，否则用 manifest 声明 */
function effectiveAutoStart(name, manifest) {
  if (name in settings.autoStart) return !!settings.autoStart[name]
  return !!manifest.autoStart
}

const CONSOLE_PORT = parseInt(
  process.env.CONSOLE_PORT || String(settings.general.consolePort || 5180), 10
)

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

/**
 * 子进程通用环境变量：
 * 经 LaunchServices（open/双击）启动时 PATH 不含 homebrew 路径，
 * 子应用会找不到 rsync/npm 等工具，这里统一补齐。
 */
function buildChildEnv(extra = {}) {
  const basePath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'
  const mergedPath = [...new Set([...basePath.split(':'), '/opt/homebrew/bin', '/usr/local/bin'])].join(':')
  return {
    ...process.env,
    PATH: mergedPath,
    NODE_ENV: process.env.NODE_ENV || 'production',
    ...extra
  }
}

/** 在子应用根目录执行 shell 命令并等待退出（输出转发到控制台日志） */
function runInApp(cmd, cwd, tag) {
  return new Promise((resolve) => {
    const p = spawn(cmd, { cwd, env: buildChildEnv(), shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    p.stdout.on('data', d => { try { process.stdout.write(`[${tag}] ${d}`) } catch {} })
    p.stderr.on('data', d => { try { process.stderr.write(`[${tag}] ${d}`) } catch {} })
    p.on('error', () => resolve(false))
    p.on('exit', (code) => resolve(code === 0))
  })
}

/**
 * requireBuild 子应用启动前确保 UI 产物存在（对齐 skill-host 安装流程）。
 * 覆盖手动放入 projectsDir、或 dist 被清理的场景 —— 这类情况下
 * server 的 /api/health 依然健康，但 GET / 会 404。
 */
async function ensureUiBuilt(entry, name) {
  const conf = entry.manifest.ui
  if (!conf?.requireBuild || !conf.buildCommand) return { ok: true }
  const distDir = path.join(entry.rootPath, conf.dist || 'ui/dist')
  try {
    await fsp.access(path.join(distDir, 'index.html'))
    return { ok: true }
  } catch {}

  console.log(`[console] ${name} UI 产物缺失，先执行构建: ${conf.buildCommand}`)
  // node_modules 缺失时先装依赖，否则构建必然失败
  try {
    await fsp.access(path.join(entry.rootPath, 'node_modules'))
  } catch {
    if (!(await runInApp('npm install --no-fund --no-audit', entry.rootPath, `${name}:install`))) {
      return { ok: false, error: `${name} 依赖安装失败` }
    }
  }
  if (!(await runInApp(conf.buildCommand, entry.rootPath, `${name}:build`))) {
    return { ok: false, error: `${name} UI 构建失败（${conf.buildCommand}）` }
  }
  return { ok: true }
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

  // UI server 启动前确保前端产物已构建（requireBuild 声明的应用）
  if (section === 'ui') {
    const built = await ensureUiBuilt(entry, name)
    if (!built.ok) return built
  }

  const portEnv = conf.portEnv || 'PORT'
  const childEnv = buildChildEnv({
    [portEnv]: String(port),
    // Electron 可执行文件以纯 Node.js 模式运行子应用 server，
    // 避免每个子进程在 macOS Dock 上产生额外图标
    ELECTRON_RUN_AS_NODE: '1'
  })

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

/**
 * 启动所有 manifest 声明 autoStart: true 的子应用。
 * 控制台启动后调用（fire-and-forget），失败只记日志不阻塞窗口。
 */
async function autoStartSubApps() {
  for (const [name, entry] of registry) {
    if (!effectiveAutoStart(name, entry.manifest)) continue
    try {
      const result = await startSubApp(name)
      if (result.ok) {
        console.log(`[console] 自动启动 ${name} 就绪 (端口 ${result.port})`)
      } else {
        console.warn(`[console] 自动启动 ${name} 失败: ${result.error}`)
      }
    } catch (err) {
      console.warn(`[console] 自动启动 ${name} 异常: ${err.message}`)
    }
  }
}

/** 组装 /console/api/apps 返回体 */
function listApps() {
  return [...registry.values()].map(({ manifest, source }) => {
    const ui = manifest.ui
    const api = manifest.api
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
      api: api && api.enabled !== false && api.port
        ? { enabled: true, port: api.port }
        : null,
      running: running.has(manifest.name),
      autoStart: effectiveAutoStart(manifest.name, manifest),
      manifestAutoStart: !!manifest.autoStart,
      autoStartOverridden: manifest.name in settings.autoStart
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

/** 读取并解析 JSON 请求体（空体返回 {}） */
function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      if (!body) return resolve({})
      try { resolve(JSON.parse(body)) }
      catch { reject(new Error('无效的 JSON 请求体')) }
    })
    req.on('error', reject)
  })
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
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
  // GET /console/api/store/apps — 多源合并+本地可用列表（含 sourceErrors）
  // ?force=1 时强制重拉注册表，绕过 5 分钟 TTL 缓存（含缓存的 sourceErrors）
  if (method === 'GET' && pathname === '/console/api/store/apps') {
    try {
      const host = await getSkillHost()
      const forceRefresh = url.searchParams.get('force') === '1'
      const { apps, sourceErrors } = await host.listAvailable({ forceRefresh })
      return sendJSON(res, 200, { apps, sourceErrors })
    } catch (err) {
      // 远程拉取失败不算服务错误，返回空列表 + 错误提示
      return sendJSON(res, 200, { apps: [], sourceErrors: [], error: err.message })
    }
  }

  // ── 商店源管理 ───────────────────────────────────────────────
  // GET /console/api/store/sources — 源列表（官方源恒在首位）
  if (method === 'GET' && pathname === '/console/api/store/sources') {
    try {
      const host = await getSkillHost()
      const sources = await host.listSources()
      return sendJSON(res, 200, { sources })
    } catch (err) {
      return sendJSON(res, 500, { sources: [], error: err.message })
    }
  }

  // POST /console/api/store/sources — 添加源 { name, url }（skill-host 内做格式/可达性验证）
  if (method === 'POST' && pathname === '/console/api/store/sources') {
    try {
      const body = await readJSONBody(req)
      const host = await getSkillHost()
      const source = await host.addSource({ name: body.name, url: body.url })
      return sendJSON(res, 200, { success: true, source })
    } catch (err) {
      return sendJSON(res, 400, { success: false, error: err.message })
    }
  }

  // DELETE /console/api/store/sources/:id — 删除源（official 返回 400）
  const dsm = pathname.match(/^\/console\/api\/store\/sources\/([^/]+)$/)
  if (method === 'DELETE' && dsm) {
    try {
      const host = await getSkillHost()
      await host.removeSource(decodeURIComponent(dsm[1]))
      return sendJSON(res, 200, { success: true })
    } catch (err) {
      return sendJSON(res, 400, { success: false, error: err.message })
    }
  }

  // POST /console/api/store/sources/:id/toggle — 启用/禁用（official 返回 400）
  const tsm = pathname.match(/^\/console\/api\/store\/sources\/([^/]+)\/toggle$/)
  if (method === 'POST' && tsm) {
    try {
      const body = await readJSONBody(req)
      const host = await getSkillHost()
      const source = await host.setSourceEnabled(decodeURIComponent(tsm[1]), !!body.enabled)
      return sendJSON(res, 200, { success: true, source })
    } catch (err) {
      return sendJSON(res, 400, { success: false, error: err.message })
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

  // ── 控制台设置（console.json）─────────────────────────────
  // GET /console/api/settings — 设置 + 运行环境元信息
  if (method === 'GET' && pathname === '/console/api/settings') {
    let projectsDirAccessible = true
    try { await fsp.access(projectsDir) } catch { projectsDirAccessible = false }
    return sendJSON(res, 200, {
      settings: {
        ...settings,
        // 开机自启回显真实系统状态而非文件值（外部可能已改）
        general: { ...settings.general, openAtLogin: app.getLoginItemSettings().openAtLogin }
      },
      meta: {
        configPath: SETTINGS_PATH,
        consolePort: CONSOLE_PORT,
        isPackaged: app.isPackaged,
        platform: process.platform,
        versions: {
          shell: pkgInfo.version || '0.0.0',
          electron: process.versions.electron,
          node: process.versions.node,
          chrome: process.versions.chrome
        },
        projectsDir,
        projectsDirAccessible,
        // 各管理键的当前生效值与来源（shell 环境变量优先于文件配置）
        envKeys: [...ENV_KEYS.network, ...ENV_KEYS.paths].map(k => ({
          key: k,
          value: settings.env[k] || '',
          activeValue: process.env[k] || '',
          // unset=未设置；file=由 console.json 注入生效；shell=由 shell 环境变量提供（优先于文件）
          source: !process.env[k] ? 'unset' : injectedEnvKeys.has(k) ? 'file' : 'shell'
        }))
      }
    })
  }

  // PUT /console/api/settings — 分组提交 { general?, env?, autoStart? }
  if (method === 'PUT' && pathname === '/console/api/settings') {
    const body = await readJSONBody(req)
    const changed = []

    if (body.general && typeof body.general === 'object') {
      const g = { ...settings.general }
      if (typeof body.general.rememberWindow === 'boolean') {
        g.rememberWindow = body.general.rememberWindow
      }
      if (typeof body.general.openAtLogin === 'boolean') {
        // 开机自启仅打包版开放（开发形态注册的是裸 Electron 二进制，登录后行为不可靠）
        if (!app.isPackaged && body.general.openAtLogin) {
          return sendJSON(res, 400, { ok: false, error: '开发模式下不可开启开机自启（仅打包版支持）' })
        }
        g.openAtLogin = body.general.openAtLogin
        try { app.setLoginItemSettings({ openAtLogin: g.openAtLogin }) }
        catch (err) { console.warn(`[console] 设置开机自启失败: ${err.message}`) }
      }
      if (body.general.consolePort !== undefined) {
        if (body.general.consolePort === null) {
          g.consolePort = null
        } else {
          const p = parseInt(body.general.consolePort, 10)
          if (!Number.isInteger(p) || p < 1024 || p > 65535) {
            return sendJSON(res, 400, { ok: false, error: '端口须为 1024-65535 的整数' })
          }
          g.consolePort = p
        }
      }
      settings.general = g
      changed.push('general')
    }

    if (body.env && typeof body.env === 'object') {
      settings.env = sanitizeEnv(body.env)
      changed.push('env')
    }

    if (body.autoStart && typeof body.autoStart === 'object') {
      const clean = {}
      for (const [name, v] of Object.entries(body.autoStart)) {
        if (typeof v !== 'boolean') continue
        // 与 manifest 默认一致的项不落盘，保持 override 表最小
        const manifestDefault = !!registry.get(name)?.manifest.autoStart
        if (v === manifestDefault) continue
        clean[name] = v
      }
      settings.autoStart = clean
      changed.push('autoStart')
    }

    const saved = saveSettings()
    return sendJSON(res, saved.ok ? 200 : 500, {
      ok: saved.ok,
      error: saved.error,
      changed,
      // env 与端口只在启动时读，改动需重启控制台（含子应用）生效
      needsRestart: changed.includes('env') || body.general?.consolePort !== undefined
    })
  }

  // POST /console/api/settings/open-path — 在 Finder 中打开目录 { target: 'config'|'projects' }
  if (method === 'POST' && pathname === '/console/api/settings/open-path') {
    const body = await readJSONBody(req)
    const targets = {
      config: path.dirname(SETTINGS_PATH),
      projects: projectsDir
    }
    const target = targets[body.target]
    if (!target) return sendJSON(res, 400, { ok: false, error: `未知目标: ${body.target}` })
    try { fs.mkdirSync(target, { recursive: true }) } catch {}
    const errMsg = await shell.openPath(target)
    if (errMsg) return sendJSON(res, 500, { ok: false, error: errMsg })
    return sendJSON(res, 200, { ok: true })
  }

  // POST /console/api/settings/restart — 重启控制台（让 env/端口改动生效）
  if (method === 'POST' && pathname === '/console/api/settings/restart') {
    sendJSON(res, 200, { ok: true })
    // 先让响应送达，再清理子应用并重启进程
    setTimeout(() => {
      cleanup()
      app.relaunch()
      app.exit(0)
    }, 150)
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

const isMac = process.platform === 'darwin'

let windowBoundsTimer = null

/** 记忆窗口位置与尺寸（最大化时仅记标记，普通 bounds 取 getNormalBounds） */
function persistWindowBounds() {
  if (!mainWindow || settings.general.rememberWindow === false) return
  try {
    settings.window = {
      bounds: mainWindow.getNormalBounds(),
      maximized: mainWindow.isMaximized()
    }
    saveSettings()
  } catch {}
}

/** 恢复上次窗口位置：与最近的屏幕工作区求交，防止拔掉外接屏后窗口落在屏幕外 */
function restoreWindowBounds() {
  if (settings.general.rememberWindow === false) return null
  const b = settings.window?.bounds
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.width) || b.width < 500 || b.height < 300) return null
  const wa = screen.getDisplayMatching(b).workArea
  return {
    x: Math.min(Math.max(b.x, wa.x - b.width + 200), wa.x + wa.width - 200),
    y: Math.min(Math.max(b.y, wa.y - b.height + 100), wa.y + wa.height - 100),
    width: b.width,
    height: b.height
  }
}

function createWindow() {
  const saved = restoreWindowBounds()
  mainWindow = new BrowserWindow({
    ...(saved || { width: 1400, height: 900 }),
    minWidth: 960,
    minHeight: 600,
    title: 'XingSeq 控制台',
    // 先隐藏，等首屏渲染完再显示，避免白底闪一下
    show: false,
    // macOS：隐藏系统标题栏、红绿灯内嵌到侧栏顶部，标题栏由前端自绘
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    // 侧栏毛玻璃：窗口底色须透明，vibrancy 才能透出桌面模糊
    ...(isMac
      ? { vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000' }
      : { backgroundColor: '#1e1e20' }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.loadURL(`http://localhost:${CONSOLE_PORT}`)
  mainWindow.once('ready-to-show', () => {
    // 上次是最大化则先最大化再显示，避免闪一下普通尺寸
    if (settings.general.rememberWindow !== false && settings.window?.maximized) {
      mainWindow?.maximize()
    }
    mainWindow?.show()
  })
  if (isDev) mainWindow.webContents.openDevTools()
  mainWindow.on('closed', () => { mainWindow = null })

  // 窗口位置/尺寸记忆：拖动/缩放防抖落盘，关闭时立即补一次
  const onBoundsChange = () => {
    if (windowBoundsTimer) clearTimeout(windowBoundsTimer)
    windowBoundsTimer = setTimeout(persistWindowBounds, 800)
  }
  mainWindow.on('resize', onBoundsChange)
  mainWindow.on('move', onBoundsChange)
  mainWindow.on('close', persistWindowBounds)
}

// 前端「在浏览器打开」：仅放行本机 http(s) 子应用地址，避免成为任意 URL 跳板
ipcMain.handle('console:open-external', async (_event, url) => {
  try {
    const u = new URL(String(url))
    const localHosts = ['localhost', '127.0.0.1', '::1']
    if (!['http:', 'https:'].includes(u.protocol) || !localHosts.includes(u.hostname)) {
      return { ok: false, error: '仅允许打开本机子应用地址' }
    }
    await shell.openExternal(u.toString())
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

app.whenReady().then(async () => {
  try {
    await loadRegistry()
    console.log(`[console] starting gateway on ${CONSOLE_PORT}...`)
    await startGateway()
    console.log('[console] creating window...')
    createWindow()
    // 窗口就绪后台自动拉起 autoStart 子应用，不阻塞控制台展示
    autoStartSubApps().catch(err => console.warn(`[console] 自动启动流程异常: ${err.message}`))
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
