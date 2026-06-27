#!/usr/bin/env node
/**
 * workspace-app CLI - 交互式工作区操作助手
 *
 * 用法：
 *   node src/cli.mjs --dry                           # 干跑：仅验证装配
 *   node src/cli.mjs --live                          # 默认工作区交互
 *   node src/cli.mjs --workspace-path /path/to/proj  # 挂载本地目录
 *   node src/cli.mjs --workspace myproject           # 名称式工作区
 *   node src/cli.mjs --once "列一下文件"             # 单轮模式
 *   node src/cli.mjs --list                          # 列出所有工作区
 */

import { setSharedEnv } from '@xingseq/shared-utils/env'
import { getLogger } from '@xingseq/shared-utils/logger'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import readline from 'node:readline'

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

// ===== 2. 业务模块 =====
const { readProxyEnabled } = await import('@xingseq/config-core')
setSharedEnv({ proxyEnabledReader: readProxyEnabled })

const { createWorkspaceRegistry } = await import('@xingseq/chat-core')
const { createConfirmationManager } = await import('@xingseq/tool-registry')
const { createProvider, resolveProviderType } = await import('./provider.mjs')
const { resolveWorkspace, ensureWorkspace, listWorkspaces, saveMountMeta } = await import('./workspace.mjs')

const logger = getLogger('workspace-app')

// ===== 3. CLI 参数 =====
const args = process.argv.slice(2)
const isLive = args.includes('--live') || (!args.includes('--dry') && !args.includes('--list'))
const isDry = args.includes('--dry')
const isList = args.includes('--list')
const isOnce = args.includes('--once')

function getArg(flag) {
  const idx = args.indexOf(flag)
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined
}

const workspacePath = getArg('--workspace-path')
const workspaceName = getArg('--workspace')
const onceMessage = isOnce
  ? args.slice(args.indexOf('--once') + 1).filter(a => !a.startsWith('--')).join(' ')
  : null

// ===== 4. --list 模式 =====
if (isList) {
  const list = await listWorkspaces()
  console.log('\n  已创建的工作区:\n')
  if (list.length === 0) {
    console.log('    (无)\n')
  } else {
    for (const w of list) {
      const tag = w.mounted ? ' [挂载]' : ''
      console.log(`    ${w.name}${tag}`)
      console.log(`      路径: ${w.root}`)
    }
    console.log()
  }
  process.exit(0)
}

// ===== 5. 解析工作区 =====
const wsOpts = { workspacePath, workspace: workspaceName }
const ws = resolveWorkspace(wsOpts)
await ensureWorkspace(ws)
if (ws.mounted) await saveMountMeta(ws)

logger.info(`workspace: ${ws.name} (${ws.mounted ? '挂载' : '名称式'})`)
logger.info(`filesDir:  ${ws.filesDir}`)
logger.info(`memoryDir: ${ws.memoryDir}`)

// ===== 6. --dry 模式 =====
if (isDry) {
  console.log('\n✓ workspace-app 装配验证通过')
  console.log(`  - workspace 解析: OK (${ws.name})`)
  console.log(`  - provider type:  ${resolveProviderType()}`)
  console.log(`  - userData:       ${userData}`)
  console.log(`  - filesDir:       ${ws.filesDir}`)
  console.log(`  - memoryDir:      ${ws.memoryDir}`)
  process.exit(0)
}

// ===== 7. 创建 session =====
const registry = await createWorkspaceRegistry({
  workspace: ws,
  enableFs: true,
  enableShell: true,
  enableWeb: true,
  enableEmail: false
})

// CLI 模式：确认管理器设为自动放行
const confirmation = createConfirmationManager({
  isCLI: true
})

const conversationId = `ws-${Date.now()}`
/** @type {import('@xingseq/chat-core').IChatProvider} */
const session = createProvider({
  id: conversationId,
  workspace: ws,
  registry
})

// ===== 8. 对话函数 =====
async function chat(userMessage) {
  process.stdout.write('\n')
  const result = await session.chat(userMessage, {
    confirmation,
    onChunk: ({ type, content, done }) => {
      if (type === 'RESPONSE' && !done && content) {
        process.stdout.write(content)
      }
      if (type === 'THINK' && !done && content) {
        // 显示思考（灰色）
        process.stdout.write(`\x1b[90m${content}\x1b[0m`)
      }
    },
    onToolCall: (tc) => {
      const name = tc.function?.name || tc.name
      console.log(`\n\x1b[36m⚙ ${name}\x1b[0m`)
    },
    onToolResult: (tc, result, error) => {
      const name = tc.function?.name || tc.name
      if (error) {
        console.log(`\x1b[31m✗ ${name}: ${error.message}\x1b[0m`)
      } else {
        const preview = typeof result === 'string'
          ? result.slice(0, 200)
          : JSON.stringify(result).slice(0, 200)
        console.log(`\x1b[32m✓ ${name}\x1b[0m ${preview}`)
      }
    }
  })
  process.stdout.write('\n\n')

  if (!result.success && result.error) {
    console.error(`\x1b[31m[错误] ${result.error.message || result.error}\x1b[0m`)
  }
  return result
}

// ===== 9. --once 模式 =====
if (isOnce && onceMessage) {
  await chat(onceMessage)
  process.exit(0)
}

// ===== 10. REPL 交互 =====
console.log(`\n\x1b[1m[workspace-app]\x1b[0m 工作区: ${ws.name} (${ws.filesDir})`)
console.log(`输入消息开始对话，Ctrl+C 退出\n`)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\x1b[1m> \x1b[0m'
})

rl.prompt()

rl.on('line', async (line) => {
  const text = line.trim()
  if (!text) { rl.prompt(); return }
  if (text === '/quit' || text === '/exit') {
    await session.save().catch(() => null)
    console.log('再见！')
    process.exit(0)
  }
  if (text === '/save') {
    await session.save()
    console.log('对话已保存')
    rl.prompt()
    return
  }
  if (text === '/clear') {
    session.clear()
    console.log('对话已清空')
    rl.prompt()
    return
  }

  await chat(text)
  rl.prompt()
})

rl.on('close', async () => {
  await session.save().catch(() => null)
  console.log('\n再见！')
  process.exit(0)
})
