#!/usr/bin/env node
/**
 * chat-app CLI - 交互式多轮对话 REPL（含工具调用）
 *
 * 用法：
 *   node src/cli.mjs                            # 交互式 dry 模式（默认，mock LLM）
 *   node src/cli.mjs --live                     # 交互式真实模式（需 DEEPSEEK_API_KEY）
 *   node src/cli.mjs --once "你好"              # 单轮 dry 后退出
 *   node src/cli.mjs --once --live "你好"       # 单轮 live 后退出
 *   node src/cli.mjs --list                     # 列出最近对话
 *   node src/cli.mjs --resume <id>              # 加载指定对话继续聊
 *   node src/cli.mjs --resume <id> --live
 *
 * REPL 命令（输入开头加 :）：
 *   :help        显示帮助
 *   :tools       列出已注册工具
 *   :history     显示当前对话历史
 *   :save        保存当前对话
 *   :clear       清空当前会话
 *   :quit / :q   退出
 */

import { setSharedEnv } from '@xingseq/shared-utils/env'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import readline from 'node:readline/promises'

// ===== 1. 注入 shared env（必须在 import 业务模块前） =====
const tmpUserData = path.join(os.tmpdir(), 'xingseq-chat-app')
fs.mkdirSync(tmpUserData, { recursive: true })

setSharedEnv({
  isCLI: true,
  importers: {
    cliLogger: () => import('electron-log/node.js').catch(() => ({ default: console }))
  },
  getApp: () => ({
    getPath: () => tmpUserData,
    isReady: () => true,
    whenReady: async () => {}
  }),
  systemModelsPath: null
})

// ===== 2. 业务模块 import =====
const { createChatSession, createDemoRegistry } = await import('./chatSession.js')
const memoryStore = await import('@xingseq/memory-store')

// ===== 3. 解析参数 =====
const args = process.argv.slice(2)
const isLive = args.includes('--live')
const isOnce = args.includes('--once')
const isList = args.includes('--list')
const resumeIdx = args.indexOf('--resume')
const resumeId = resumeIdx >= 0 ? args[resumeIdx + 1] : null
const userMessage = args
  .filter((a, i) => !a.startsWith('--') && a !== resumeId)
  .join(' ')
  .trim()

// ===== 4. 子命令：--list =====
if (isList) {
  const factory = memoryStore.getConversationFactory()
  const indexManager = factory.getManager(null)
  const result = await indexManager.getAll()
  if (!result.success || result.data.length === 0) {
    console.log('还没有对话记录')
  } else {
    console.log('\n最近对话：')
    result.data.slice(0, 20).forEach(c => {
      console.log(`  [${c.id}] ${c.title} | ${new Date(c.updated_at).toLocaleString('zh-CN', { hour12: false })} | ${c.preview || ''}`)
    })
  }
  process.exit(0)
}

// ===== 5. 创建会话 =====
const registry = createDemoRegistry({ cwd: process.cwd() })
const session = createChatSession({
  id: resumeId || undefined,
  registry
})

if (resumeId) {
  const r = await session.load()
  if (!r.success) {
    console.error(`加载对话 ${resumeId} 失败：${r.error || '不存在'}`)
    process.exit(2)
  }
  console.log(`已恢复对话 [${resumeId}] - ${session.title}（${session.messages.length} 条消息）`)
}

// ===== 6. dry 模式 mock executor =====
// 第一次输入：返回 tool_calls=[get_time] + content
// 第二次（工具结果回来后）：返回最终文本
let mockTurn = 0
function mockExecutor(opts) {
  const userMsg = [...opts.messages].reverse().find(m => m.role === 'user')?.content || ''
  const lastIsTool = opts.messages[opts.messages.length - 1]?.role === 'tool'

  if (!lastIsTool && /时间|几点|time|now/i.test(userMsg)) {
    // 第一轮：触发工具
    const id = `call_${Date.now()}_${mockTurn++}`
    return Promise.resolve({
      success: true,
      fullContent: '我来查一下当前时间。',
      toolCalls: [{
        id,
        type: 'function',
        function: { name: 'get_time', arguments: JSON.stringify({ format: 'locale' }) }
      }],
      fragments: [],
      model: 'mock-model'
    })
  }
  if (!lastIsTool && /读.*文件|read.*file/i.test(userMsg)) {
    const id = `call_${Date.now()}_${mockTurn++}`
    // 尝试解析路径 - 简单用 package.json
    return Promise.resolve({
      success: true,
      fullContent: '好，我读 package.json 看看。',
      toolCalls: [{
        id,
        type: 'function',
        function: { name: 'read_file', arguments: JSON.stringify({ path: 'package.json' }) }
      }],
      fragments: [],
      model: 'mock-model'
    })
  }
  if (lastIsTool) {
    const toolMsg = opts.messages[opts.messages.length - 1]
    const reply = `已收到工具结果：${toolMsg.content.slice(0, 120)}${toolMsg.content.length > 120 ? '...' : ''}`
    // 流式输出
    if (opts.onChunk) {
      for (const ch of reply) {
        opts.onChunk({ type: 'RESPONSE', content: ch, done: false })
      }
      opts.onChunk({ type: 'RESPONSE', content: '', done: true })
    }
    return Promise.resolve({
      success: true,
      fullContent: reply,
      toolCalls: [],
      fragments: [{ type: 'RESPONSE', content: reply }],
      model: 'mock-model'
    })
  }
  // 普通回复
  const reply = `[mock] 已收到："${userMsg}"。这是 dry 模式回复。`
  if (opts.onChunk) {
    for (const ch of reply) {
      opts.onChunk({ type: 'RESPONSE', content: ch, done: false })
    }
    opts.onChunk({ type: 'RESPONSE', content: '', done: true })
  }
  return Promise.resolve({
    success: true,
    fullContent: reply,
    toolCalls: [],
    fragments: [{ type: 'RESPONSE', content: reply }],
    model: 'mock-model'
  })
}

// ===== 7. 单轮处理一条消息 =====
async function chatOnce(input) {
  process.stdout.write('AI: ')
  let printed = false

  const result = await session.chat(input, {
    customParams: { systemPrompt: '你是一个友好的助手。可用工具：get_time / read_file / list_dir。' },
    executor: isLive ? undefined : mockExecutor,
    onChunk: ({ type, content, done }) => {
      if (type === 'RESPONSE' && !done && content) {
        process.stdout.write(content)
        printed = true
      }
    },
    onToolCall: (tc) => {
      if (printed) process.stdout.write('\n')
      process.stdout.write(`  ⚙ 调用工具 ${tc.function.name}(${tc.function.arguments})\n`)
      printed = false
    },
    onToolResult: (tc, res, err) => {
      if (err) {
        process.stdout.write(`  ✗ ${tc.function.name} 失败: ${err.message}\n`)
      } else {
        const preview = JSON.stringify(res).slice(0, 200)
        process.stdout.write(`  ✓ ${tc.function.name} → ${preview}${preview.length >= 200 ? '...' : ''}\n`)
      }
      process.stdout.write('AI: ')
    }
  })

  if (!result.success) {
    process.stdout.write(`\n[错误] ${result.error?.message || '未知'}\n`)
    return false
  }
  process.stdout.write('\n')
  return true
}

// ===== 8. --once 单轮模式 =====
if (isOnce || (userMessage && !resumeId)) {
  if (!userMessage) {
    console.error('--once 需要带消息内容')
    process.exit(2)
  }
  console.log(`[模式] ${isLive ? 'live' : 'dry'}  [对话] ${session.id}`)
  console.log(`User: ${userMessage}`)
  const ok = await chatOnce(userMessage)
  if (ok) {
    const saveResult = await session.save()
    console.log(`\n✓ 已保存：${saveResult.path || saveResult.success}`)
  }
  process.exit(ok ? 0 : 1)
}

// ===== 9. 交互式 REPL =====
console.log(`
=== chat-app REPL ===
模式: ${isLive ? 'live (真实 LLM)' : 'dry (mock)'}
对话 ID: ${session.id}
工具组: ${registry.getOverview().map(o => `${o.displayName}(${o.toolCount})`).join(', ')}

输入消息开始对话，或输入 :help 查看命令。
`)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: process.stdin.isTTY,
  crlfDelay: Infinity
})

let exited = false
// 管道输入遇到 EOF 时退出
rl.on('close', () => {
  exited = true
  if (pendingResolver) { pendingResolver(null); pendingResolver = null }
})

// 以队列 + 'line' 事件实现连续读行（同时兼容 TTY 和管道）
const inputQueue = []
let pendingResolver = null
rl.on('line', (line) => {
  if (pendingResolver) {
    const r = pendingResolver; pendingResolver = null; r(line)
  } else {
    inputQueue.push(line)
  }
})
function nextLine() {
  if (inputQueue.length) return Promise.resolve(inputQueue.shift())
  if (exited) return Promise.resolve(null)
  return new Promise(resolve => { pendingResolver = resolve })
}

function showHelp() {
  console.log(`
可用命令：
  :help        显示帮助
  :tools       列出已注册工具
  :history     显示当前对话历史
  :save        保存当前对话到 memory-store
  :clear       清空当前会话消息
  :quit, :q    退出（不自动保存）
  :exit        保存并退出
`)
}

function showTools() {
  const all = registry.getAllTools()
  console.log(`\n共 ${all.length} 个工具:`)
  for (const t of all) {
    const params = Object.keys(t.function.parameters?.properties || {}).join(', ') || '-'
    console.log(`  ${t.function.name.padEnd(15)} ${t.function.description}  [params: ${params}]`)
  }
  console.log()
}

function showHistory() {
  console.log(`\n共 ${session.messages.length} 条消息:`)
  session.messages.forEach((m, i) => {
    const role = m.role.padEnd(9)
    if (m.tool_calls?.length) {
      console.log(`  ${String(i).padStart(2)} [${role}] (调用 ${m.tool_calls.map(tc => tc.function.name).join(',')}) ${(m.content || '').slice(0, 60)}`)
    } else {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      console.log(`  ${String(i).padStart(2)} [${role}] ${c.slice(0, 80)}${c.length > 80 ? '...' : ''}`)
    }
  })
  console.log()
}

while (!exited) {
  if (process.stdin.isTTY) process.stdout.write('> ')
  const input = await nextLine()
  if (input === null) break
  const line = input.trim()
  if (!line) continue

  switch (line) {
    case ':help':
      showHelp(); continue
    case ':tools':
      showTools(); continue
    case ':history':
      showHistory(); continue
    case ':clear':
      session.clear(); console.log('已清空当前会话'); continue
    case ':save': {
      const r = await session.save()
      console.log(r.success ? `✓ 已保存: ${r.path}` : `✗ 保存失败: ${r.error}`)
      continue
    }
    case ':quit':
    case ':q':
      exited = true; break
    case ':exit': {
      const r = await session.save()
      console.log(r.success ? `✓ 已保存: ${r.path}` : `✗ 保存失败: ${r.error}`)
      exited = true; break
    }
    default:
      try {
        await chatOnce(line)
      } catch (err) {
        console.error(`\n[异常] ${err.message}`)
      }
  }
}

rl.close()
console.log('再见。')
