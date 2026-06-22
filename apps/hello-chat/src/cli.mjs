#!/usr/bin/env node
/**
 * hello-chat CLI - L1 验收 demo
 *
 * 验证 shared-utils / config-core / llm-core 三个 L1 基座包在 monorepo 中：
 *   1. 可以被正确解析（npm workspaces 链接）
 *   2. setSharedEnv 注入点工作
 *   3. config-core 与 shared-utils 之间通过 env 完成解耦
 *   4. llm-core 的核心 API 串联完整
 *
 * 用法：
 *   node src/cli.mjs --dry           # 干跑（默认）：不调用真实 API，仅验证装配
 *   node src/cli.mjs --live          # 真跑：要求 env DEEPSEEK_API_KEY 已设置
 *   DEEPSEEK_API_KEY=sk-xxx node src/cli.mjs --live "你好"
 */

import { setSharedEnv } from '@xingseq/shared-utils/env'
import { getLogger } from '@xingseq/shared-utils/logger'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// ===== 1. 注入 shared env =====
//   提供一个最小 app 实现：userData 指向临时目录
const tmpUserData = path.join(os.tmpdir(), 'xingseq-hello-chat')
fs.mkdirSync(tmpUserData, { recursive: true })

setSharedEnv({
  isCLI: true,
  importers: {
    cliLogger: () => import('electron-log/node.js').catch(() => ({ default: console }))
  },
  getApp: async () => ({
    getPath: (name) => {
      if (name === 'userData' || name === 'logs') return tmpUserData
      return tmpUserData
    },
    isReady: () => true,
    whenReady: async () => {}
  }),
  systemModelsPath: null
})

// ===== 2. 注入 config-core 的 readProxyEnabled 给 shared-utils =====
//   这是分包后双向依赖的解耦点
const { readProxyEnabled } = await import('@xingseq/config-core')
setSharedEnv({ proxyEnabledReader: readProxyEnabled })

const logger = getLogger('hello-chat')

// ===== 3. CLI 参数 =====
const args = process.argv.slice(2)
const isLive = args.includes('--live')
const isDry = args.includes('--dry') || !isLive
const userMessage = args.filter(a => !a.startsWith('--')).join(' ') || '用一句话介绍你自己'

logger.info(`mode = ${isDry ? 'dry' : 'live'}`)
logger.info(`userData = ${tmpUserData}`)

// ===== 4. 验证 config-core 装配 =====
const configCore = await import('@xingseq/config-core')
logger.info(`config-core 导出 API 数量: ${Object.keys(configCore).length}`)

// 尝试读取 generalConfig（应得到默认值，无外部文件依赖）
const generalConfig = await configCore.loadGeneralConfig()
logger.info(`generalConfig.proxyEnabled = ${generalConfig.proxyEnabled}`)

// ===== 5. 验证 llm-core 装配 =====
const llmCore = await import('@xingseq/llm-core')
logger.info(`llm-core 导出 API 数量: ${Object.keys(llmCore).length}`)

// buildRequestParams 干跑：验证模型选择与参数结构
const { requestParams, model } = llmCore.buildRequestParams({
  messages: [{ role: 'user', content: userMessage }],
  mode: 'chat',
  customParams: { systemPrompt: 'You are a helpful assistant.' },
  provider: 'deepseek'
})
logger.info(`requestParams.model = ${model}`)
logger.info(`requestParams.max_tokens = ${requestParams.max_tokens}`)

// parseStream 干跑：用 mock stream 走一遍
async function* mockStream() {
  yield { choices: [{ delta: { content: 'Hello' },  finish_reason: null }] }
  yield { choices: [{ delta: { content: ' from' },   finish_reason: null }] }
  yield { choices: [{ delta: { content: ' L1!' },    finish_reason: null }] }
  yield { choices: [{ delta: {},                     finish_reason: 'stop' }] }
}
const parsed = await llmCore.parseStream(mockStream(), null)
logger.info(`parseStream 验证: "${parsed.fullContent}"`)
if (parsed.fullContent !== 'Hello from L1!') {
  console.error('✗ parseStream 输出不符合预期')
  process.exit(1)
}

// ===== 6. live 模式：真实调用 =====
if (isLive) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    console.error('✗ live 模式需要环境变量 DEEPSEEK_API_KEY')
    process.exit(2)
  }
  logger.info('开始真实调用 DeepSeek...')
  process.stdout.write('\n[AI] ')
  const result = await llmCore.executeChat({
    apiKey,
    messages: [{ role: 'user', content: userMessage }],
    provider: 'deepseek',
    mode: 'chat',
    customParams: { systemPrompt: '你是一个友好的助手，请用一两句话简短回答。' },
    onChunk: ({ type, content, done }) => {
      if (type === 'RESPONSE' && !done && content) {
        process.stdout.write(content)
      }
    }
  })
  process.stdout.write('\n\n')
  if (result.success) {
    logger.info(`完成 (model=${result.model}, 字数=${result.fullContent.length})`)
  } else {
    console.error(`✗ 调用失败: [${result.error.code}] ${result.error.message}`)
    process.exit(3)
  }
}

console.log('\n✓ L1 hello-chat 验收通过')
console.log(`   - shared-utils env 注入: OK`)
console.log(`   - config-core ↔ shared-utils 解耦注入 (proxyEnabledReader): OK`)
console.log(`   - llm-core (buildRequestParams + parseStream${isLive ? ' + executeChat (live)' : ''}): OK`)
