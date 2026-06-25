#!/usr/bin/env node
/**
 * mail-app 邮件网关
 *
 * 收到邮件 → IChatProvider.chat(邮件内容) → AI 回复 → SMTP 回复原发件人
 *
 * 架构：
 *   EmailMonitor (IMAP 轮询) → email 事件 → IChatProvider.chat() → AI 回复 → sendEmail() 回复
 *
 * AI 处理过程中可调 send_email 工具给第三方发邮件（走确认流程）。
 *
 * 用法（通过 CLI 路由进入）：
 *   mail-app gateway                    # 真实邮箱 + 真实 LLM
 *   mail-app gateway --mock             # 虚拟邮箱 + 真实 LLM
 *   mail-app gateway --dry              # 虚拟邮箱 + mock LLM（完全离线测试）
 *   mail-app once --dry 帮我查一下时间  # 单次对话测试（不启动监听）
 *
 * 配置（~/.xingseq/mail-app/config/mail.json 或环境变量）
 */

import { setSharedEnv } from '@xingseq/shared-utils/env'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// ===== 1. 注入 shared env =====
const userData = path.join(os.homedir(), '.xingseq', 'mail-app')
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
const {
  EmailMonitor,
  MockEmailMonitor,
  VirtualMailboxStore,
  createWorkspaceRegistry,
  resolveWorkspace,
  ensureWorkspace,
  createChatSession
} = await import('@xingseq/chat-core')
const { createProvider } = await import('./provider.mjs')
const { loadMailConfig, sendEmail } = await import('./send.mjs')

// ===== 3. 解析参数 =====
const args = process.argv.slice(2)
const isMock = args.includes('--mock')
const isDry = args.includes('--dry')
const isOnce = args.includes('--once')

const onceMessage = args.filter(a => !a.startsWith('--')).join(' ').trim()

// ===== 4. 加载邮件配置 =====
const mailConfig = loadMailConfig()

// ===== 5. 状态持久化（去重：不重复处理已处理邮件） =====
const stateDir = path.join(userData, 'state')
const stateFile = path.join(stateDir, 'gateway.json')
const processedEmails = new Set()

function loadState() {
  try {
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      for (const id of state.processedEmails || []) {
        processedEmails.add(id)
      }
      console.log(`[mail-gateway] 已加载 ${processedEmails.size} 条已处理记录`)
    }
  } catch (err) {
    console.warn(`[mail-gateway] 状态加载失败: ${err.message}`)
  }
}

function saveState() {
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(stateFile, JSON.stringify({
      processedEmails: Array.from(processedEmails),
      lastUpdate: new Date().toISOString()
    }, null, 2))
  } catch (err) {
    console.warn(`[mail-gateway] 状态保存失败: ${err.message}`)
  }
}

loadState()

// ===== 6. dry 模式 mock executor =====
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
        id, type: 'function',
        function: { name: 'get_time', arguments: JSON.stringify({ format: 'locale' }) }
      }],
      fragments: [], model: 'mock-model'
    })
  }
  if (!lastIsTool && /发.*邮件|send.*mail|发信/i.test(userMsg)) {
    const id = `call_${Date.now()}_${mockTurn++}`
    return Promise.resolve({
      success: true,
      fullContent: '好，我帮你发一封邮件。',
      toolCalls: [{
        id, type: 'function',
        function: { name: 'send_email', arguments: JSON.stringify({ to: 'test@example.com', subject: '测试邮件', body: '这是一封测试邮件。' }) }
      }],
      fragments: [], model: 'mock-model'
    })
  }
  if (lastIsTool) {
    const toolMsg = opts.messages[opts.messages.length - 1]
    const reply = `已处理：${toolMsg.content.slice(0, 200)}`
    if (opts.onChunk) {
      for (const ch of reply) opts.onChunk({ type: 'RESPONSE', content: ch, done: false })
      opts.onChunk({ type: 'RESPONSE', content: '', done: true })
    }
    return Promise.resolve({
      success: true, fullContent: reply, toolCalls: [],
      fragments: [{ type: 'RESPONSE', content: reply }], model: 'mock-model'
    })
  }
  const reply = `[mock] 已收到你的邮件："${userMsg.slice(0, 100)}"。这是 dry 模式回复。`
  if (opts.onChunk) {
    for (const ch of reply) opts.onChunk({ type: 'RESPONSE', content: ch, done: false })
    opts.onChunk({ type: 'RESPONSE', content: '', done: true })
  }
  return Promise.resolve({
    success: true, fullContent: reply, toolCalls: [],
    fragments: [{ type: 'RESPONSE', content: reply }], model: 'mock-model'
  })
}

// ===== 7. 创建邮件监听器 =====
function createMailMonitor() {
  if (isDry || isMock) {
    const account = mailConfig.email || 'assistant@test.local'
    const monitor = new MockEmailMonitor({
      email: account,
      imap: { auth: { user: account, pass: '' } },
      smtp: { auth: { user: account, pass: '' } },
      senderFilter: mailConfig.senderFilter,
      subjectKeywords: mailConfig.subjectKeywords,
      pollInterval: isDry ? 2000 : (mailConfig.pollInterval || 2000)
    })
    console.log(`[mail-gateway] 虚拟邮箱模式，账户: ${account}`)
    return monitor
  }

  if (!mailConfig.imap.auth.user || !mailConfig.imap.auth.pass) {
    console.error('[mail-gateway] 邮箱配置不完整！')
    console.error(`  请配置: ~/.xingseq/mail-app/config/mail.json`)
    console.error('  或设置环境变量 EMAIL_USER 和 EMAIL_PASSWORD')
    process.exit(1)
  }

  const monitor = new EmailMonitor({
    email: mailConfig.email,
    imap: mailConfig.imap,
    smtp: mailConfig.smtp,
    senderFilter: mailConfig.senderFilter,
    subjectKeywords: mailConfig.subjectKeywords,
    pollInterval: mailConfig.pollInterval
  })
  console.log(`[mail-gateway] 真实邮箱模式，监听: ${mailConfig.email}`)
  return monitor
}

// ===== 8. 创建会话 =====
async function createMailSession(monitor) {
  const workspace = resolveWorkspace({ workspace: 'mail-gateway' })
  ensureWorkspace(workspace)

  // 邮件网关内部发邮件：
  // - dry/mock 模式：用 monitor.sendEmail（虚拟发送，只写日志）
  // - live 模式：用 send.mjs 的 sendEmail（真实 SMTP）
  const emailSendFn = async (to, subject, body, options = {}) => {
    if (isDry || isMock) {
      return monitor.sendEmail(to, subject, body, options)
    }
    return sendEmail({ to, subject, body, attachments: options.attachments, config: mailConfig })
  }

  const registry = await createWorkspaceRegistry({
    workspace,
    enableEmail: true,
    emailSendFn
  })

  const session = createProvider({
    workspace,
    registry
  })

  return { session, workspace }
}

// ===== 9. 邮件 → 对话 → 回复 =====

// 统一回复发送：dry/mock 走 monitor，live 走真实 SMTP
async function replySend(monitor, to, subject, body) {
  if (isDry || isMock) {
    return monitor.sendEmail(to, subject, body)
  }
  return sendEmail({ to, subject, body, config: mailConfig })
}

function formatEmailContent(email) {
  return [
    `【邮件来自】${email.from}`,
    `【邮件主题】${email.subject}`,
    `【邮件时间】${email.date}`,
    '',
    email.content || ''
  ].join('\n')
}

function extractToAddresses(toField) {
  if (!toField) return []
  return toField.split(/[,;]/).map(s => {
    const match = s.trim().match(/<([^>]+)>/)
    return match ? match[1].trim().toLowerCase() : s.trim().toLowerCase()
  }).filter(Boolean)
}

async function handleEmail(email, session, monitor) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`📨 收到邮件`)
  console.log(`   主题: ${email.subject}`)
  console.log(`   发件人: ${email.from}`)
  console.log(`   时间: ${email.date}`)

  // 去重
  const emailId = email.raw?.uid || email.raw?.messageId
  if (emailId && processedEmails.has(emailId)) {
    console.log(`   ⏭️  邮件 ${emailId} 已处理，跳过`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    return
  }

  // 收件人匹配
  const selfEmail = (mailConfig.email || '').trim().toLowerCase()
  if (selfEmail) {
    const toAddresses = extractToAddresses(email.to)
    const isToSelf = toAddresses.some(addr => addr === selfEmail)
    if (!isToSelf && toAddresses.length > 0) {
      console.log(`   ⏭️  收件人 ${email.to} 与当前账号 ${selfEmail} 不匹配，跳过`)
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
      return
    }
  }

  // 标记已处理
  if (emailId) {
    processedEmails.add(emailId)
    saveState()
  }

  const content = formatEmailContent(email)

  try {
    console.log('🤖 交给 AI 处理...')

    const result = await session.chat(content, {
      executor: isDry ? mockExecutor : undefined,
      customParams: {
        systemPrompt: [
          '你是一个邮件助手。用户通过邮件与你对话，你的回复将通过邮件直接发送给用户。',
          '请简洁、清晰地回答用户的问题。',
          '如果你需要发送邮件给第三方，可以使用 send_email 工具。',
          '当前工作区可用于读写文件、执行命令。'
        ].join('\n')
      },
      onToolCall: (tc) => {
        console.log(`  ⚙ 调用工具 ${tc.function.name}(${tc.function.arguments})`)
      },
      onToolResult: (tc, res, err) => {
        if (err) console.log(`  ✗ ${tc.function.name} 失败: ${err.message}`)
        else console.log(`  ✓ ${tc.function.name} → ${JSON.stringify(res).slice(0, 200)}`)
      }
    })

    if (!result.success) {
      console.error(`[mail-gateway] AI 处理失败: ${result.error?.message || '未知'}`)
      const errBody = `处理您的邮件时出现错误：\n\n${result.error?.message || '未知错误'}\n\n请稍后重试。\n\n---\n星序 AI 助手`
      await replySend(monitor, email.from, `Re: ${email.subject}`, errBody)
      return
    }

    // 框架层自动回复
    const replyBody = result.fullContent || '(空回复)'
    const replyResult = await replySend(monitor, email.from, `Re: ${email.subject}`, replyBody)

    if (replyResult.success) {
      console.log(`✅ 回复已发送 → ${email.from}`)
    } else {
      console.error(`❌ 回复失败: ${replyResult.error}`)
    }

    await session.save()
  } catch (err) {
    console.error(`[mail-gateway] 处理邮件异常: ${err.message}`)
    await replySend(
      monitor, email.from,
      `Re: ${email.subject}`,
      `处理您的邮件时出现异常：\n\n${err.message}\n\n请稍后重试。\n\n---\n星序 AI 助手`
    ).catch(() => {})
    // 失败时移除标记，下次可重试
    if (emailId) {
      processedEmails.delete(emailId)
      saveState()
    }
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

// ===== 10. --once：单次对话测试 =====
if (isOnce) {
  if (!onceMessage) {
    console.error('--once 需要带消息内容')
    process.exit(2)
  }

  console.log(`[mail-app] 单次测试模式  ${isDry ? '(dry)' : isMock ? '(mock)' : '(live)'}`)

  const monitor = createMailMonitor()
  const { session } = await createMailSession(monitor)

  const result = await session.chat(onceMessage, {
    executor: isDry ? mockExecutor : undefined,
    customParams: {
      systemPrompt: '你是一个邮件助手。请简洁回答。'
    },
    onToolCall: (tc) => console.log(`  ⚙ ${tc.function.name}(${tc.function.arguments})`),
    onToolResult: (tc, res, err) => {
      if (err) console.log(`  ✗ ${tc.function.name}: ${err.message}`)
      else console.log(`  ✓ ${tc.function.name} → ${JSON.stringify(res).slice(0, 200)}`)
    }
  })

  if (result.success) {
    console.log(`\nAI: ${result.fullContent}`)
  } else {
    console.error(`\n[错误] ${result.error?.message || '未知'}`)
  }
  process.exit(0)
}

// ===== 11. 启动邮件网关 =====
console.log('═══════════════════════════════════════════')
console.log('  星序邮件网关 (MailGateway)')
console.log('═══════════════════════════════════════════')

const monitor = createMailMonitor()
const { session } = await createMailSession(monitor)

if (monitor.dependenciesAvailable === false) {
  console.error('[mail-gateway] 邮件监听依赖不可用')
  if (!isDry && !isMock) {
    console.error('请安装: npm install imap mailparser nodemailer')
    process.exit(1)
  }
}

monitor.on('email', (email) => {
  handleEmail(email, session, monitor).catch(err => {
    console.error('[mail-gateway] handleEmail 异常:', err)
  })
})

monitor.on('error', (err) => {
  console.error('[mail-gateway] 监听错误:', err.message)
})

await monitor.start()

console.log(`\n📧 邮件网关已启动`)
console.log(`   监听邮箱: ${mailConfig.email || 'assistant@test.local'}`)
console.log(`   接受发件人: ${mailConfig.senderFilter || '(所有人)'}`)
console.log(`   轮询间隔: ${(mailConfig.pollInterval || 60000) / 1000}秒`)
console.log(`   模式: ${isDry ? 'dry（离线测试）' : isMock ? 'mock（虚拟邮箱）' : 'live（真实邮箱）'}`)
console.log(`\n⏹️  按 Ctrl+C 停止\n`)

if (isDry || isMock) {
  console.log('💡 测试方法: 另开终端执行')
  console.log('   npx mail-app send-test "你好，帮我查一下时间"')
  console.log('')
}

process.on('SIGINT', () => {
  console.log('\n🛑 正在停止邮件网关...')
  monitor.stop()
  console.log('✅ 已停止')
  process.exit(0)
})

process.on('SIGTERM', () => {
  monitor.stop()
  process.exit(0)
})
