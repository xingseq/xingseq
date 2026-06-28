#!/usr/bin/env node
/**
 * llm-manager CLI 入口
 *
 * 启动 HTTP 服务，提供 LLM 模型配置管理 API + Web 前端
 *
 * 用法：
 *   node src/cli.mjs              # 启动服务（默认端口 7820）
 *   node src/cli.mjs --port 9000  # 自定义端口
 */

import path from 'path'
import os from 'os'
import fs from 'fs'
import { setSharedEnv } from '@xingseq/shared-utils/env'

// ===== 1. 注入 shared env =====
const userData = path.join(os.homedir(), '.xingseq', 'llm-manager')
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

// ===== 2. 解析参数 =====
const args = process.argv.slice(2)
const portIdx = args.indexOf('--port')
const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 7820

// ===== 3. 启动 server =====
const { startServer } = await import('./server.mjs')
startServer(port)
