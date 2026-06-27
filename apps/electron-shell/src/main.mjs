#!/usr/bin/env node
/**
 * @xingseq/electron-shell
 * Electron 主进程入口
 *
 * 职责：
 *   1. 启动 workspace-app HTTP+SSE 服务（端口 3002）
 *   2. 启动本地静态文件 + API 代理服务（端口 5174），服务 workspace-app/web/dist
 *   3. 创建浏览器窗口加载本地页面
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

const workspaceAppRoot = path.resolve(__dirname, '..', '..', 'workspace-app')
const webDistDir = path.join(workspaceAppRoot, 'web', 'dist')

const SERVER_PORT = parseInt(process.env.WORKSPACE_APP_PORT || '3002', 10)
const WEB_PORT = parseInt(process.env.WORKSPACE_APP_WEB_PORT || '5174', 10)

let serverProcess = null
let staticServer = null
let mainWindow = null

/**
 * 启动 workspace-app 后端服务
 */
function startWorkspaceServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(workspaceAppRoot, 'src', 'server.mjs')
    serverProcess = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PORT: String(SERVER_PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let ready = false
    serverProcess.stdout.on('data', (data) => {
      const text = data.toString()
      process.stdout.write(text)
      if (!ready && text.includes(`http://localhost:${SERVER_PORT}`)) {
        ready = true
        resolve()
      }
    })

    serverProcess.stderr.on('data', (data) => {
      process.stderr.write(data.toString())
    })

    serverProcess.on('error', reject)
    serverProcess.on('exit', (code) => {
      if (!ready) reject(new Error(`workspace-app server exited with code ${code}`))
    })

    setTimeout(() => {
      if (!ready) reject(new Error('workspace-app server start timeout'))
    }, 15000)
  })
}

/**
 * 静态文件服务 + /api 代理到 workspace-app server
 */
async function startStaticServer() {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.cjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  }

  const serveFile = async (res, filePath) => {
    try {
      const stat = await fsp.stat(filePath)
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html')
      }
      const ext = path.extname(filePath).toLowerCase()
      const contentType = mimeTypes[ext] || 'application/octet-stream'
      const content = await fsp.readFile(filePath)
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(content)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
    }
  }

  staticServer = http.createServer(async (req, res) => {
    // 代理 /api 到 workspace-app server
    if (req.url.startsWith('/api')) {
      const options = {
        hostname: 'localhost',
        port: SERVER_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `localhost:${SERVER_PORT}` }
      }
      const proxy = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers)
        proxyRes.pipe(res, { end: true })
      })
      proxy.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: err.message }))
      })
      req.pipe(proxy, { end: true })
      return
    }

    // 静态文件
    const targetPath = req.url === '/' ? 'index.html' : decodeURIComponent(req.url)
    await serveFile(res, path.join(webDistDir, targetPath))
  })

  await new Promise((resolve, reject) => {
    staticServer.listen(WEB_PORT, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'workspace-app',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const loadUrl = `http://localhost:${WEB_PORT}`
  mainWindow.loadURL(loadUrl)

  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  try {
    console.log('[electron-shell] starting workspace-app server...')
    await startWorkspaceServer()
    console.log(`[electron-shell] starting static server on ${WEB_PORT}...`)
    await startStaticServer()
    console.log('[electron-shell] creating window...')
    createWindow()
  } catch (err) {
    console.error('[electron-shell] failed to start:', err)
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
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
  if (staticServer) {
    staticServer.close()
    staticServer = null
  }
}

app.on('before-quit', cleanup)
process.on('SIGTERM', () => { cleanup(); app.quit() })
process.on('SIGINT', () => { cleanup(); app.quit() })
