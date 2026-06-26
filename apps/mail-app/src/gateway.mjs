#!/usr/bin/env node
/**
 * mail-app 邮件网关
 *
 * 收到邮件 → 调 chat-app CLI/SSE → AI 回复 → SMTP 回复原发件人
 *
 * 架构：
 *   EmailMonitor (IMAP 轮询) → email 事件 → chatClient 调 chat-app → AI 回复 → sendEmail() 回复
 *
 * mail-app 不直接管理 LLM/API Key，统一通过 chat-app 处理 AI 对话。
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
  VirtualMailboxStore
} = await import('@xingseq/chat-core')
const { loadMailConfig, sendEmail } = await import('./send.mjs')
const { chatWithAssistant, getConversationId } = await import('./chatClient.mjs')

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

// ===== 6. (已移除 mockExecutor，dry 模式改走 chat-app CLI --once 不加 --live) =====

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

// ===== 8. (已移除 createMailSession，所有模式统一通过 chatClient 调 chat-app) =====

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

async function handleEmail(email, monitor) {
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

    // 统一通过 chatClient 调 chat-app
    // dry 模式: live=false（chat-app CLI 用 mock LLM）
    // mock/live 模式: live=true（chat-app CLI 用真实 LLM）
    const conversationId = getConversationId(email.from)
    const chatMode = mailConfig.chatMode || 'cli'

    console.log(`   💬 会话: ${conversationId}  模式: ${chatMode}  live: ${!isDry}`)

    const chatResult = await chatWithAssistant({
      message: content,
      conversationId,
      workspace: 'mail-gateway',
      mode: chatMode,
      live: !isDry,
      sseConfig: {
        host: mailConfig.chatHost || 'localhost',
        port: mailConfig.chatPort || 3001
      }
    })

    // 打印工具调用日志
    if (chatResult.toolCalls?.length) {
      for (const tc of chatResult.toolCalls) {
        console.log(`  ⚙ 调用工具 ${tc.name}(${tc.arguments})`)
      }
    }
    if (chatResult.toolResults?.length) {
      for (const tr of chatResult.toolResults) {
        if (tr.success) {
          console.log(`  ✓ ${tr.name} → ${JSON.stringify(tr.result).slice(0, 200)}`)
        } else {
          console.log(`  ✗ ${tr.name} 失败: ${tr.error}`)
        }
      }
    }

    const result = {
      success: chatResult.success,
      fullContent: chatResult.reply,
      error: chatResult.error ? { message: chatResult.error } : null
    }

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
      console.log(`\u2705 \u56de\u590d\u5df2\u53d1\u9001 \u2192 ${email.from}  messageId: ${replyResult.messageId || 'N/A'}`)
    } else {
      console.error(`\u274c \u56de\u590d\u5931\u8d25: ${replyResult.error}`)
    }
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

  console.log(`[mail-app] 单次测试模式  ${isDry ? '(dry)' : isMock ? '(mock)' : '(live)'}  live: ${!isDry}`)

  // 统一通过 chatClient 调 chat-app
  const chatMode = mailConfig.chatMode || 'cli'
  console.log(`[mail-app] 调用 chat-app (${chatMode})...`)

  const chatResult = await chatWithAssistant({
    message: onceMessage,
    conversationId: `mail-once-test`,
    workspace: 'mail-gateway',
    mode: chatMode,
    live: !isDry,
    sseConfig: {
      host: mailConfig.chatHost || 'localhost',
      port: mailConfig.chatPort || 3001
    }
  })

  if (chatResult.toolCalls?.length) {
    for (const tc of chatResult.toolCalls) {
      console.log(`  ⚙ ${tc.name}(${tc.arguments})`)
    }
  }
  if (chatResult.toolResults?.length) {
    for (const tr of chatResult.toolResults) {
      if (tr.success) console.log(`  ✓ ${tr.name} → ${JSON.stringify(tr.result).slice(0, 200)}`)
      else console.log(`  ✗ ${tr.name}: ${tr.error}`)
    }
  }

  if (chatResult.success) {
    console.log(`\nAI: ${chatResult.reply}`)
  } else {
    console.error(`\n[错误] ${chatResult.error || '未知'}`)
  }
  process.exit(0)
}

// ===== 11. 启动邮件网关 =====
console.log('═══════════════════════════════════════════')
console.log('  星序邮件网关 (MailGateway)')
console.log('═══════════════════════════════════════════')

const monitor = createMailMonitor()
if (monitor.ready) await monitor.ready()  // EmailMonitor 需等待依赖检查完成

if (monitor.dependenciesAvailable === false) {
  console.error('[mail-gateway] 邮件监听依赖不可用')
  if (!isDry && !isMock) {
    console.error('请安装: npm install imap mailparser nodemailer')
    process.exit(1)
  }
}

monitor.on('email', (email) => {
  handleEmail(email, monitor).catch(err => {
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
