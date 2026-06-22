#!/usr/bin/env node
/**
 * chat-app CLI - 交互式多轮对话 REPL（含工具调用 + 默认工作区）
 *
 * 用法：
 *   node src/cli.mjs                            # 交互式 dry 模式（mock LLM，使用默认 workspace）
 *   node src/cli.mjs --live                     # 交互式真实模式（需 DEEPSEEK_API_KEY）
 *   node src/cli.mjs --workspace mywork         # 切换/创建名为 mywork 的工作区
 *   node src/cli.mjs --once "你好"              # 单轮 dry 后退出
 *   node src/cli.mjs --once --live "你好"       # 单轮 live 后退出
 *   node src/cli.mjs --list                     # 列出当前 workspace 的对话历史
 *   node src/cli.mjs --list-workspaces          # 列出所有 workspace
 *   node src/cli.mjs --resume <id>              # 加载指定对话继续聊
 *
 * REPL 命令（输入开头加 :）：
 *   :help        显示帮助
 *   :pwd         显示当前 workspace 信息
 *   :ls          列出工作区文件（等同于让 AI 调 list_dir，但同步直出）
 *   :tools       列出已注册工具
 *   :history     显示当前对话历史
 *   :save        保存当前对话到 workspace 记忆
 *   :clear       清空当前会话
 *   :quit / :q   退出（不自动保存）
 *   :exit        保存并退出
 */

import { setSharedEnv } from '@xingseq/shared-utils/env'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import readline from 'node:readline/promises'

// ===== 1. 注入 shared env（必须在 import 业务模块前） =====
// userData 用 ~/.xingseq/chat-app（稳定路径，作为记忆中心；不用 tmpdir 避免重启被清）
const userData = path.join(os.homedir(), '.xingseq', 'chat-app')
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

// ===== 2. 业务模块 import =====
const { createChatSession, createWorkspaceRegistry } = await import('./chatSession.js')
const { resolveWorkspace, ensureWorkspace, listWorkspaces } = await import('./workspace.js')
const { createWorkspaceStore } = await import('./workspaceStore.js')

// ===== 3. 解析参数 =====
const args = process.argv.slice(2)
const isLive = args.includes('--live')
const isOnce = args.includes('--once')
const isList = args.includes('--list')
const isListWs = args.includes('--list-workspaces')

function readArg(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const resumeId = readArg('--resume')
const wsName = readArg('--workspace')

// 普通文本（消息内容）= 排除所有 -- 选项及其后跟的值
const flagsWithValue = new Set(['--resume', '--workspace'])
const userMessage = args
  .filter((a, i) => {
    if (a.startsWith('--')) return false
    const prev = args[i - 1]
    if (flagsWithValue.has(prev)) return false
    return true
  })
  .join(' ')
  .trim()

// ===== 4. 解析并准备 workspace =====
let workspace
try {
  workspace = resolveWorkspace({ workspace: wsName })
} catch (err) {
  console.error(`[workspace] ${err.message}`)
  process.exit(2)
}
const ensured = await ensureWorkspace(workspace)

// ===== 5. 子命令：--list-workspaces =====
if (isListWs) {
  const all = await listWorkspaces()
  if (all.length === 0) {
    console.log('暂无 workspace。当前默认 workspace 已创建：' + workspace.root)
  } else {
    console.log(`\n共 ${all.length} 个 workspace：`)
    all.forEach(w => {
      const tag = w.name === workspace.name ? ' (current)' : ''
      console.log(`  [${w.name}]${tag}  ${w.root}`)
    })
  }
  process.exit(0)
}

// ===== 6. 子命令：--list（列出当前 workspace 的对话） =====
if (isList) {
  const store = createWorkspaceStore(workspace.memoryDir)
  const list = await store.listConversations({ limit: 30 })
  console.log(`\n[workspace: ${workspace.name}]`)
  if (list.length === 0) {
    console.log('  还没有对话记录')
  } else {
    list.forEach(c => {
      const t = new Date(c.updatedAt).toLocaleString('zh-CN', { hour12: false })
      console.log(`  [${c.id}] ${c.title} | ${t} | ${c.messageCount}条 | ${c.preview || ''}`)
    })
  }
  process.exit(0)
}

// ===== 7. 创建会话 =====
const registry = createWorkspaceRegistry({ workspace })
const session = createChatSession({
  id: resumeId || undefined,
  workspace,
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

// ===== 8. dry 模式 mock executor =====
let mockTurn = 0
function mockExecutor(opts) {
  const userMsg = [...opts.messages].reverse().find(m => m.role === 'user')?.content || ''
  const lastIsTool = opts.messages[opts.messages.length - 1]?.role === 'tool'

  if (!lastIsTool && /时间|几点|time|now/i.test(userMsg)) {
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
  if (!lastIsTool && /列.*文件|工作区|有什么|看看|list/i.test(userMsg)) {
    const id = `call_${Date.now()}_${mockTurn++}`
    return Promise.resolve({
      success: true,
      fullContent: '好，我列一下工作区的文件。',
      toolCalls: [{
        id,
        type: 'function',
        function: { name: 'list_dir', arguments: JSON.stringify({ path: '.' }) }
      }],
      fragments: [],
      model: 'mock-model'
    })
  }
  if (!lastIsTool && /读.*文件|read.*file|README|NOTES/i.test(userMsg)) {
    const id = `call_${Date.now()}_${mockTurn++}`
    // 智能挑文件：优先 README.md，其次 NOTES.md
    const file = /NOTES/i.test(userMsg) ? 'NOTES.md' : 'README.md'
    return Promise.resolve({
      success: true,
      fullContent: `好，我读一下 ${file}。`,
      toolCalls: [{
        id,
        type: 'function',
        function: { name: 'read_file', arguments: JSON.stringify({ path: file }) }
      }],
      fragments: [],
      model: 'mock-model'
    })
  }
  if (lastIsTool) {
    const toolMsg = opts.messages[opts.messages.length - 1]
    const reply = `已收到工具结果：${toolMsg.content.slice(0, 200)}${toolMsg.content.length > 200 ? '...' : ''}`
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

// ===== 9. 单轮处理一条消息 =====
async function chatOnce(input) {
  process.stdout.write('AI: ')
  let printed = false

  const result = await session.chat(input, {
    customParams: {
      systemPrompt: `你是一个友好的助手。当前工作区为 "${workspace.name}"，根目录: ${workspace.filesDir}。\n可用工具：get_time / read_file / list_dir。所有路径相对于工作区根目录。`
    },
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

// ===== 10. --once 单轮模式 =====
if (isOnce || (userMessage && !resumeId)) {
  if (!userMessage) {
    console.error('--once 需要带消息内容')
    process.exit(2)
  }
  console.log(`[模式] ${isLive ? 'live' : 'dry'}  [workspace] ${workspace.name}  [对话] ${session.id}`)
  console.log(`User: ${userMessage}`)
  const ok = await chatOnce(userMessage)
  if (ok) {
    const saveResult = await session.save()
    console.log(`\n${saveResult.success ? '✓' : '✗'} 保存：${saveResult.path || saveResult.error}`)
  }
  process.exit(ok ? 0 : 1)
}

// ===== 11. 交互式 REPL =====
console.log(`
=== chat-app REPL ===
模式:      ${isLive ? 'live (真实 LLM)' : 'dry (mock)'}
workspace: ${workspace.name}${ensured.created ? ' (首次创建，已写入欢迎文件)' : ''}
files:     ${workspace.filesDir}
memory:    ${workspace.memoryDir}
对话 ID:   ${session.id}
工具组:    ${registry.getOverview().map(o => `${o.displayName}(${o.toolCount})`).join(', ')}

输入消息开始对话，或输入 :help 查看命令。
`)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: process.stdin.isTTY,
  crlfDelay: Infinity
})

const inputQueue = []
let pendingResolver = null
let exited = false

rl.on('close', () => {
  exited = true
  if (pendingResolver) { pendingResolver(null); pendingResolver = null }
})
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
  :pwd         显示当前 workspace（名称、files 目录、memory 目录）
  :ls          列出工作区根目录文件
  :tools       列出已注册工具
  :history     显示当前对话历史
  :save        保存当前对话到 workspace 记忆
  :clear       清空当前会话消息
  :quit, :q    退出（不自动保存）
  :exit        保存并退出
`)
}

function showPwd() {
  console.log(`
workspace: ${workspace.name}
root:      ${workspace.root}
files:     ${workspace.filesDir}
memory:    ${workspace.memoryDir}
`)
}

async function showLs() {
  try {
    const entries = await fs.promises.readdir(workspace.filesDir, { withFileTypes: true })
    if (entries.length === 0) {
      console.log('(空目录)')
      return
    }
    console.log(`\n${workspace.filesDir}:`)
    entries.forEach(e => {
      const tag = e.isDirectory() ? 'dir ' : (e.isFile() ? 'file' : 'other')
      console.log(`  ${tag}  ${e.name}`)
    })
    console.log()
  } catch (err) {
    console.error(`列目录失败：${err.message}`)
  }
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
    case ':pwd':
      showPwd(); continue
    case ':ls':
      await showLs(); continue
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
