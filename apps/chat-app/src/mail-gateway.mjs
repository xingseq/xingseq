#!/usr/bin/env node
/**
 * MailGateway - 邮件网关服务
 *
 * 收到邮件 → IChatProvider.chat(邮件内容) → AI 回复 → SMTP 回复原发件人
 *
 * 架构：
 *   EmailMonitor (IMAP 轮询) → email 事件 → IChatProvider.chat() → AI 回复 → monitor.sendEmail() 回复
 *
 * AI 处理过程中可调 send_email 工具给第三方发邮件（走确认流程）。
 *
 * 用法：
 *   node src/mail-gateway.mjs                        # 真实邮箱 + 真实 LLM
 *   node src/mail-gateway.mjs --mock                 # 虚拟邮箱 + 真实 LLM（测试用）
 *   node src/mail-gateway.mjs --dry                  # 虚拟邮箱 + mock LLM（完全离线测试）
 *   node src/mail-gateway.mjs --send-test "你好"     # 向虚拟邮箱投递一封测试邮件
 *   node src/mail-gateway.mjs --once "帮我查一下时间" # 单次对话测试（不启动监听）
 *
 * 配置（环境变量或 ~/.xingseq/chat-app/config/mail.json）：
 *   EMAIL_USER          邮箱账号
 *   EMAIL_PASSWORD      邮箱密码（授权码）
 *   EMAIL_SENDER_FILTER 只接受此发件人的邮件（留空 = 接受所有人）
 *   EMAIL_IMAP_HOST     IMAP 主机（默认 imap.qq.com）
 *   EMAIL_IMAP_PORT     IMAP 端口（默认 993）
 *   EMAIL_SMTP_HOST     SMTP 主机（默认 smtp.qq.com）
 *   EMAIL_SMTP_PORT     SMTP 端口（默认 465）
 *   EMAIL_POLL_INTERVAL 轮询间隔毫秒（默认 60000）
 */

import { setSharedEnv } from '@xingseq/shared-utils/env'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// ===== 1. 注入 shared env（与 cli.mjs 一致） =====
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

// ===== 3. 解析参数 =====
const args = process.argv.slice(2)
const isMock = args.includes('--mock')
const isDry = args.includes('--dry')
const isSendTest = args.includes('--send-test')
const isOnce = args.includes('--once')

function readArg(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

// 普通文本（消息内容）= 所有非 -- 开头的参数
const onceMessage = args.filter(a => !a.startsWith('--')).join(' ').trim()

// ===== 4. 加载邮件配置 =====
const configDir = path.join(userData, 'config')
const mailConfigFile = path.join(configDir, 'mail.json')

function loadMailConfig() {
  // 优先从配置文件读
  let fileConfig = {}
  try {
    if (fs.existsSync(mailConfigFile)) {
      fileConfig = JSON.parse(fs.readFileSync(mailConfigFile, 'utf8'))
    }
  } catch (err) {
    console.warn(`[mail-gateway] 配置文件读取失败: ${err.message}`)
  }

  // 环境变量覆盖
  const env = process.env
  return {
    email: fileConfig.email || env.EMAIL_USER || '',
    senderFilter: fileConfig.senderFilter || env.EMAIL_SENDER_FILTER || '',
    subjectKeywords: fileConfig.subjectKeywords || [],
    pollInterval: Number(fileConfig.pollInterval || env.EMAIL_POLL_INTERVAL || 60000),
    imap: {
      host: fileConfig.imap?.host || env.EMAIL_IMAP_HOST || 'imap.qq.com',
      port: Number(fileConfig.imap?.port || env.EMAIL_IMAP_PORT || 993),
      secure: fileConfig.imap?.secure ?? true,
      auth: {
        user: fileConfig.imap?.auth?.user || env.EMAIL_USER || fileConfig.email || '',
        pass: fileConfig.imap?.auth?.pass || env.EMAIL_PASSWORD || ''
      }
    },
    smtp: {
      host: fileConfig.smtp?.host || env.EMAIL_SMTP_HOST || 'smtp.qq.com',
      port: Number(fileConfig.smtp?.port || env.EMAIL_SMTP_PORT || 465),
      secure: fileConfig.smtp?.secure ?? true,
      auth: {
        user: fileConfig.smtp?.auth?.user || env.EMAIL_USER || fileConfig.email || '',
        pass: fileConfig.smtp?.auth?.pass || env.EMAIL_PASSWORD || ''
      }
    }
  }
}

const mailConfig = loadMailConfig()

// ===== 4.5 状态持久化（迁移自 develop/agents/mail-assistant.js loadState/saveState） =====
// 确保进程重启后不会重复处理已处理过的邮件
const stateDir = path.join(userData, '..', 'mail-gateway')
const stateFile = path.join(stateDir, 'state.json')
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
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true })
    }
    fs.writeFileSync(stateFile, JSON.stringify({
      processedEmails: Array.from(processedEmails),
      lastUpdate: new Date().toISOString()
    }, null, 2))
  } catch (err) {
    console.warn(`[mail-gateway] 状态保存失败: ${err.message}`)
  }
}

loadState()

// ===== 5. dry 模式 mock executor（与 cli.mjs 一致） =====
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

// ===== 6. 创建邮件监听器 =====
function createMailMonitor() {
  if (isDry || isMock) {
    // 虚拟邮箱模式
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

  // 真实邮箱模式
  if (!mailConfig.imap.auth.user || !mailConfig.imap.auth.pass) {
    console.error('[mail-gateway] 邮箱配置不完整！')
    console.error(`  请设置环境变量 EMAIL_USER 和 EMAIL_PASSWORD`)
    console.error(`  或创建配置文件: ${mailConfigFile}`)
    console.error('  示例:')
    console.error('  {')
    console.error('    "email": "your@mail.com",')
    console.error('    "imap": { "auth": { "user": "your@mail.com", "pass": "授权码" } },')
    console.error('    "smtp": { "auth": { "user": "your@mail.com", "pass": "授权码" } },')
    console.error('    "senderFilter": "friend@example.com"')
    console.error('  }')
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

// ===== 7. 创建会话 =====
function createMailSession(monitor) {
  const workspace = resolveWorkspace({ workspace: 'mail-gateway' })
  ensureWorkspace(workspace)

  // 注册工具组：workspace + web + fs + shell + email
  // email 工具的 sendFn = monitor.sendEmail，AI 可主动发邮件
  const registry = createWorkspaceRegistry({
    workspace,
    enableEmail: true,
    emailSendFn: (...a) => monitor.sendEmail(...a)
  })

  /** @type {import('@xingseq/chat-core').IChatProvider} */
  const session = createProvider({
    workspace,
    registry
  })

  return { session, workspace }
}

// ===== 8. 邮件 → 对话 → 回复 =====
function formatEmailContent(email) {
  return [
    `【邮件来自】${email.from}`,
    `【邮件主题】${email.subject}`,
    `【邮件时间】${email.date}`,
    '',
    email.content || ''
  ].join('\n')
}

/**
 * 从邮件 to 字段提取邮箱地址列表
 */
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

  // 去重：检查是否已处理过（迁移自 develop mail-assistant.handleEmail）
  const emailId = email.raw?.uid || email.raw?.messageId
  if (emailId && processedEmails.has(emailId)) {
    console.log(`   ⏭️  邮件 ${emailId} 已处理，跳过`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    return
  }

  // 收件人匹配检查：确保邮件是发给当前账号的（迁移自 develop mail-assistant.handleEmail）
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

  // 标记为已处理（立即标记，避免并发重复）
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
        if (err) {
          console.log(`  ✗ ${tc.function.name} 失败: ${err.message}`)
        } else {
          const preview = JSON.stringify(res).slice(0, 200)
          console.log(`  ✓ ${tc.function.name} → ${preview}`)
        }
      }
    })

    if (!result.success) {
      console.error(`[mail-gateway] AI 处理失败: ${result.error?.message || '未知'}`)
      // 发送错误回复
      const errBody = `处理您的邮件时出现错误：\n\n${result.error?.message || '未知错误'}\n\n请稍后重试。\n\n---\n星序 AI 助手`
      await monitor.sendEmail(email.from, `Re: ${email.subject}`, errBody)
      return
    }

    // 框架层自动回复：AI 的回复文本 → SMTP 回复原发件人
    const replyBody = result.fullContent || '(空回复)'
    const replyResult = await monitor.sendEmail(email.from, `Re: ${email.subject}`, replyBody)

    if (replyResult.success) {
      console.log(`✅ 回复已发送 → ${email.from}`)
    } else {
      console.error(`❌ 回复失败: ${replyResult.error}`)
    }

    // 保存对话
    await session.save()
  } catch (err) {
    console.error(`[mail-gateway] 处理邮件异常: ${err.message}`)
    const errBody = `处理您的邮件时出现异常：\n\n${err.message}\n\n请稍后重试。\n\n---\n星序 AI 助手`
    await monitor.sendEmail(email.from, `Re: ${email.subject}`, errBody).catch(() => {})
    // 处理失败时移除已处理标记，下次可以重试
    if (emailId) {
      processedEmails.delete(emailId)
      saveState()
    }
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

// ===== 9. --send-test：向虚拟邮箱投递测试邮件 =====
if (isSendTest) {
  const testContent = onceMessage || '这是一封测试邮件'
  const account = mailConfig.email || 'assistant@test.local'
  const sender = mailConfig.senderFilter || 'user@test.local'

  await VirtualMailboxStore.deliver({
    from: sender,
    to: account,
    subject: '测试邮件',
    content: testContent
  })

  console.log(`[mail-gateway] 测试邮件已投递: ${sender} → ${account}`)
  console.log(`  主题: 测试邮件`)
  console.log(`  内容: ${testContent}`)
  process.exit(0)
}

// ===== 10. --once：单次对话测试（不启动监听） =====
if (isOnce) {
  if (!onceMessage) {
    console.error('--once 需要带消息内容')
    process.exit(2)
  }

  console.log(`[mail-gateway] 单次测试模式  ${isDry ? '(dry)' : isMock ? '(mock)' : '(live)'}`)

  const monitor = createMailMonitor()
  const { session } = createMailSession(monitor)

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
const { session } = createMailSession(monitor)

// 等待依赖检查
if (monitor.dependenciesAvailable === false) {
  console.error('[mail-gateway] 邮件监听依赖不可用')
  if (!isDry && !isMock) {
    console.error('请安装: npm install imap mailparser nodemailer')
    process.exit(1)
  }
}

// 绑定邮件事件
monitor.on('email', (email) => {
  handleEmail(email, session, monitor).catch(err => {
    console.error('[mail-gateway] handleEmail 异常:', err)
  })
})

monitor.on('error', (err) => {
  console.error('[mail-gateway] 监听错误:', err.message)
})

// 启动
await monitor.start()

console.log(`\n📧 邮件网关已启动`)
console.log(`   监听邮箱: ${mailConfig.email || 'assistant@test.local'}`)
console.log(`   接受发件人: ${mailConfig.senderFilter || '(所有人)'}`)
console.log(`   轮询间隔: ${(monitor.config.pollInterval || 60000) / 1000}秒`)
console.log(`   模式: ${isDry ? 'dry（离线测试）' : isMock ? 'mock（虚拟邮箱）' : 'live（真实邮箱）'}`)
console.log(`\n⏹️  按 Ctrl+C 停止\n`)

if (isDry || isMock) {
  console.log('💡 测试方法: 另开终端执行')
  console.log('   node src/mail-gateway.mjs --send-test "你好，帮我查一下时间"')
  console.log('')
}

// 优雅退出
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
