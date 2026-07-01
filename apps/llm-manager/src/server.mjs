/**
 * llm-manager HTTP 服务
 *
 * API 路由：
 *   GET  /api/models         → 全局模型列表
 *   PUT  /api/models         → 保存全局模型配置
 *   GET  /api/providers      → Provider 子模型列表
 *   PUT  /api/providers      → 保存 Provider 子模型配置
 *   GET  /api/default-model  → 当前默认模型
 *   PUT  /api/default-model  → 设置默认模型
 *   POST /api/test-connection→ 连通性测试
 */

import http from 'http'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'node:url'
import { promises as fsp } from 'fs'
import { getLogger } from '@xingseq/shared-utils/logger'
import { setSharedEnv } from '@xingseq/shared-utils/env'
import {
  loadModelConfig,
  saveGlobalModelConfig,
  loadProviderSubModels,
  saveGlobalProviderSubModels,
  loadDefaultModel,
  saveGlobalDefaultModel,
  getGlobalConfigPath
} from '@xingseq/config-core'
import { executeChat } from '@xingseq/llm-core'

const logger = getLogger('LLM-Manager')

// ==================== 辅助函数 ====================

function sendJSON(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
      } catch (e) {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

// ==================== 路由处理 ====================

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost`)
  const { pathname } = url
  const method = req.method

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    })
    return res.end()
  }

  // GET /api/models
  if (method === 'GET' && pathname === '/api/models') {
    const result = await loadModelConfig()
    return sendJSON(res, 200, result.data)
  }

  // PUT /api/models
  if (method === 'PUT' && pathname === '/api/models') {
    const body = await readBody(req)
    const result = await saveGlobalModelConfig(body)
    return sendJSON(res, result.success ? 200 : 500, result)
  }

  // GET /api/providers
  if (method === 'GET' && pathname === '/api/providers') {
    const result = await loadProviderSubModels()
    return sendJSON(res, 200, result.data)
  }

  // PUT /api/providers
  if (method === 'PUT' && pathname === '/api/providers') {
    const body = await readBody(req)
    const result = await saveGlobalProviderSubModels(body)
    return sendJSON(res, result.success ? 200 : 500, result)
  }

  // GET /api/default-model
  if (method === 'GET' && pathname === '/api/default-model') {
    const result = await loadDefaultModel()
    return sendJSON(res, 200, result.data)
  }

  // PUT /api/default-model
  if (method === 'PUT' && pathname === '/api/default-model') {
    const body = await readBody(req)
    const result = await saveGlobalDefaultModel(body)
    return sendJSON(res, result.success ? 200 : 500, result)
  }

  // POST /api/test-connection
  if (method === 'POST' && pathname === '/api/test-connection') {
    const body = await readBody(req)
    const { provider, apiKey, subModel } = body
    if (!apiKey) {
      return sendJSON(res, 400, { ok: false, error: '缺少 apiKey' })
    }
    const start = Date.now()
    try {
      const result = await executeChat({
        apiKey,
        provider: provider || 'deepseek',
        subModel: subModel || undefined,
        messages: [{ role: 'user', content: 'hi' }],
        customParams: { max_tokens: 1, stream: false }
      })
      const latency_ms = Date.now() - start
      if (result.success) {
        return sendJSON(res, 200, { ok: true, latency_ms, model: result.model })
      } else {
        return sendJSON(res, 200, { ok: false, error: result.error?.message || '未知错误', latency_ms })
      }
    } catch (e) {
      const latency_ms = Date.now() - start
      return sendJSON(res, 200, { ok: false, error: e.message, latency_ms })
    }
  }

  // 静态文件（Web 前端 dist）
  if (method === 'GET' && !pathname.startsWith('/api/')) {
    const distDir = path.resolve(import.meta.dirname, '..', 'web', 'dist')
    let filePath = path.join(distDir, pathname === '/' ? 'index.html' : pathname)
    try {
      const stat = await fsp.stat(filePath)
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html')
      const content = await fsp.readFile(filePath)
      const ext = path.extname(filePath)
      const mimeMap = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }
      res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' })
      return res.end(content)
    } catch {
      // SPA fallback
      try {
        const html = await fsp.readFile(path.join(distDir, 'index.html'))
        res.writeHead(200, { 'Content-Type': 'text/html' })
        return res.end(html)
      } catch {
        return sendJSON(res, 404, { error: 'Not found' })
      }
    }
  }

  sendJSON(res, 404, { error: 'Not found' })
}

// ==================== 启动 ====================

export function startServer(port = 7820) {
  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res)
    } catch (err) {
      logger.error('请求处理失败:', err)
      sendJSON(res, 500, { error: err.message })
    }
  })

  server.listen(port, () => {
    logger.info(`LLM Manager 服务已启动: http://localhost:${port}`)
    console.log(`\n  🤖 LLM Manager`)
    console.log(`     API:  http://localhost:${port}/api/models`)
    console.log(`     Web:  http://localhost:${port}/`)
    console.log(`     配置: ${getGlobalConfigPath()}\n`)
  })

  return server
}

// ==================== 直接运行入口 ====================
// `npm run server` 实际执行 `node src/server.mjs`，即直接运行本文件。
// 若不做处理，本文件仅 export startServer 而无人调用，进程会立即退出，
// 导致前端 Vite 代理 /api → :7820 时 ECONNREFUSED。
//
// 这里通过「主模块判断」加入口：当本文件被作为主模块直接运行时，
// 执行与 cli.mjs 一致的 setSharedEnv 初始化（userData 目录、CLI logger
// 工厂、app 路径提供器等），再启动 HTTP 服务；当被 cli.mjs 或其他模块
// import 时则跳过，避免重复启动。使用 fileURLToPath 规范化路径比较，
// 保证在 Windows（盘符 + 反斜杠）与 POSIX 下均能正确匹配。
const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] === __filename) {
  // 与 cli.mjs 保持一致：准备 llm-manager 专用 userData 目录
  const userData = path.join(os.homedir(), '.xingseq', 'llm-manager')
  await fsp.mkdir(userData, { recursive: true })

  // 注入共享环境：
  //   - isCLI: true              → logger 走 CLI 分支（避免在纯 Node 下尝试加载 electron-log/main.js）
  //   - importers.cliLogger      → 动态加载日志后端，失败时退化为 console
  //   - getApp                   → 提供 getPath('userData')，供 file transport 等使用
  //   - systemModelsPath: null   → 不挂载系统模型只读配置（与 cli 默认一致）
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

  // 端口优先取环境变量 LLM_MANAGER_PORT，默认 7820（与 vite.config.js 代理目标一致）
  const port = parseInt(process.env.LLM_MANAGER_PORT || '7820', 10)
  startServer(port)
}
