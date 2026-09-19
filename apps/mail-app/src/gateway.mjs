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
import http from 'node:http'
import { fileURLToPath } from 'node:url'

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
const { loadMailConfig, saveMailConfig, sendEmail } = await import('./send.mjs')
const { chatWithAssistant, getConversationId } = await import('./chatClient.mjs')

// ===== 3. 解析参数 =====
const args = process.argv.slice(2)
const isMock = args.includes('--mock')
const isDry = args.includes('--dry')
const isOnce = args.includes('--once')

const onceMessage = args.filter(a => !a.startsWith('--')).join(' ').trim()

// ===== 4. 加载邮件配置 =====
// let：GUI 保存配置后需重新赋值以热重载（见 applyConfig）
let mailConfig = loadMailConfig()

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

// ===== 5.5 日志轮转（launchd StandardOutPath 只增不减，按大小滚动防止无限膨胀）=====
// launchd 以 O_APPEND 打开日志文件并持有 fd：重命名会让它继续写入旧 inode，
// 因此采用「复制到 .1 → 截断 live 到 0」——O_APPEND 下截断后下次写入自动落到新 EOF(0)，
// 与 launchd 持有的 fd 兼容。单文件超过 LOG_MAX_BYTES 触发，归档保留 LOG_KEEP 份。
const logsDir = path.join(userData, 'logs')
const LOG_MAX_BYTES = parseInt(process.env.MAIL_LOG_MAX_BYTES || String(5 * 1024 * 1024), 10)
const LOG_KEEP = parseInt(process.env.MAIL_LOG_KEEP || '3', 10)
const ROTATE_CHECK_MS = 10 * 60 * 1000

function rotateOneLog(baseName) {
  const live = path.join(logsDir, baseName)
  try {
    if (!fs.existsSync(live)) return
    const size = fs.statSync(live).size
    if (size < LOG_MAX_BYTES) return
    const oldest = `${live}.${LOG_KEEP}`
    if (fs.existsSync(oldest)) fs.rmSync(oldest)
    for (let i = LOG_KEEP - 1; i >= 1; i--) {
      const from = `${live}.${i}`
      if (fs.existsSync(from)) fs.renameSync(from, `${live}.${i + 1}`)
    }
    fs.copyFileSync(live, `${live}.1`)
    fs.truncateSync(live, 0)
    console.log(`[mail-gateway] 日志轮转: ${baseName} ${(size / 1024 / 1024).toFixed(1)}MB → ${baseName}.1`)
  } catch (err) {
    console.warn(`[mail-gateway] 日志轮转失败(${baseName}): ${err.message}`)
  }
}

function rotateLogs() {
  rotateOneLog('gateway.stdout.log')
  rotateOneLog('gateway.stderr.log')
}

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

// 热重载守卫：正在处理邮件时不重建监听器，避免中断在飞的回复；
// 保存的配置会挂起，待当前邮件处理完（handleEmail 的 finally）再生效。
let isBusy = false
let pendingReload = false

function applyConfig() {
  if (isBusy) {
    pendingReload = true
    console.log('[mail-gateway] 配置已保存，将在当前邮件处理完后热重载生效')
    return { deferred: true }
  }
  mailConfig = loadMailConfig()
  try { monitor?.stop?.() } catch (err) {
    console.warn(`[mail-gateway] 热重载停止旧监听器失败: ${err.message}`)
  }
  monitor = createMailMonitor()
  monitorRunning = false
  ;(async () => {
    if (monitor.ready) await monitor.ready()
    await monitor.start()
    monitorRunning = true
    console.log(`[mail-gateway] 配置热重载完成，监听: ${mailConfig.email || '(未设置)'}  发件人: ${mailConfig.senderFilter || '(所有人)'}`)
  })().catch(err => {
    console.error(`[mail-gateway] 热重载启动监听器失败: ${err.message}`)
  })
  return { deferred: false }
}

function drainPendingReload() {
  if (pendingReload && !isBusy) {
    pendingReload = false
    applyConfig()
  }
}

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

  isBusy = true
  try {
    console.log('🤖 交给 AI 处理...')

    // 统一通过 chatClient 调 chat-app
    // dry 模式: live=false（chat-app CLI 用 mock LLM）
    // mock/live 模式: live=true（chat-app CLI 用真实 LLM）
    const conversationId = getConversationId(email.from)
    const chatMode = mailConfig.chatMode || 'cli'
    const timeoutMs = Math.max(1, Number(mailConfig.chatTimeoutMin) || 60) * 60 * 1000
    const ackDelayMs = (Number(mailConfig.ackDelaySec) || 0) * 1000

    console.log(`   💬 会话: ${conversationId}  模式: ${chatMode}  live: ${!isDry}  超时: ${Math.round(timeoutMs / 60000)}min  ack: ${ackDelayMs > 0 ? ackDelayMs / 1000 + 's' : '关闭'}`)

    // 延迟 ack：起 chat promise 的同时挂一个定时器，超过 ackDelayMs 仍未完成就先回一封
    // 「正在处理」，跑完再发结果。快邮件在阈值内完成 → 只发一封正常回信，无噪音。
    let done = false
    let ackSent = false
    let ackTimer = null
    const chatPromise = chatWithAssistant({
      message: content,
      conversationId,
      workspace: 'mail-gateway',
      mode: chatMode,
      live: !isDry,
      timeoutMs,
      sseConfig: {
        host: mailConfig.chatHost || 'localhost',
        port: mailConfig.chatPort || 3001
      }
    })
    if (ackDelayMs > 0) {
      ackTimer = setTimeout(async () => {
        if (done) return
        ackSent = true
        console.log('   ⏳ 处理超过阈值，先发送「正在处理」回执')
        await replySend(
          monitor, email.from, `Re: ${email.subject}`,
          '已收到你的邮件，正在处理中，完成后会单独发送结果。\n\n---\n星序 AI 助手'
        ).catch(() => {})
      }, ackDelayMs)
      ackTimer.unref?.()
    }
    const chatResult = await chatPromise
    done = true
    if (ackTimer) clearTimeout(ackTimer)

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
      timedOut: Boolean(chatResult.timedOut),
      error: chatResult.error ? { message: chatResult.error } : null
    }

    // ack 已发出时，结果用带「（处理结果）」的主题，避免和 ack 撞在一起看不清
    const replySubject = ackSent ? `Re: ${email.subject}（处理结果）` : `Re: ${email.subject}`

    if (!result.success) {
      console.error(`[mail-gateway] AI 处理失败: ${result.error?.message || '未知'}`)
      const errBody = result.timedOut
        ? `处理您的邮件超时（${result.error?.message || '已超过时限被中止'}）。\n\n请简化需求或稍后重试。\n\n---\n星序 AI 助手`
        : `处理您的邮件时出现错误：\n\n${result.error?.message || '未知错误'}\n\n请稍后重试。\n\n---\n星序 AI 助手`
      await replySend(monitor, email.from, replySubject, errBody)
      return
    }

    // 框架层自动回复
    const replyBody = result.fullContent || '(空回复)'
    const replyResult = await replySend(monitor, email.from, replySubject, replyBody)

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
  } finally {
    isBusy = false
    drainPendingReload()
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

// ===== 10.5 管理界面 HTTP 服务（健康检查 + 项目管理 API + Web UI 静态服务）=====
// 同一端口提供三类能力，供 Electron 控制台 iframe 嵌入与运维排查：
//   /api/health           健康检查（控制台探测/复用）
//   /api/projects*        qoder_task 项目注册表 CRUD
//   /api/logs/tail        网关日志尾部（launchd StandardOutPath）
//   其余 GET              Web UI 静态文件（web/dist，SPA fallback）
// 端口同时充当实例锁：EADDRINUSE 说明已有网关在运行（如 launchd 服务），
// 直接退出，避免两个实例同时轮询 IMAP 导致同一封邮件被重复回复。
const healthPort = parseInt(process.env.MAIL_GATEWAY_PORT || '7830', 10)
const startedAt = Date.now()
let monitorRunning = false
let monitor = null   // 监听器实例（启动阶段赋值），供 /api/health 读取真实 IMAP 连接态

const webDistDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', d => {
      buf += d
      if (buf.length > 1024 * 1024) req.destroy()
    })
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
  let target = path.normalize(path.join(webDistDir, rel))
  if (!target.startsWith(webDistDir)) return sendJson(res, 403, { error: 'Forbidden' })
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    // SPA fallback：非资源路径回退 index.html
    target = path.join(webDistDir, 'index.html')
  }
  if (!fs.existsSync(target)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end('<h1>mail-app 管理界面未构建</h1><p>请先执行: cd apps/mail-app/web && npm install && npm run build</p>')
  }
  const ext = path.extname(target).toLowerCase()
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
  fs.createReadStream(target).pipe(res)
}

async function handleApi(req, res, u) {
  const { pathname } = u
  const projects = await import('./projects.mjs')

  if (req.method === 'GET' && pathname === '/api/health') {
    // monitorRunning 仅表示 start() 调用过，无法反映 IMAP 真实连接态。
    // 额外读取监听器状态：live 模式下 imapState==='authenticated' 才算真正在线，
    // 避免网关「假死」（进程存活但 IMAP 断开）时健康检查仍报一切正常。
    // 注意：ok 字段仍表示「本端口有进程在服务」（electron-shell 复用协议依赖它），不与 IMAP 态绑定。
    const status = (monitor && typeof monitor.getStatus === 'function') ? monitor.getStatus() : null
    const imapState = status ? status.imapState : 'not-started'
    const imapConnected = (isDry || isMock) ? monitorRunning : imapState === 'authenticated'
    return sendJson(res, 200, {
      ok: true,
      service: 'mail-gateway',
      mode: isDry ? 'dry' : isMock ? 'mock' : 'live',
      email: mailConfig.email || 'assistant@test.local',
      senderFilter: mailConfig.senderFilter || '(所有人)',
      pollIntervalSec: (mailConfig.pollInterval || 60000) / 1000,
      monitorRunning,
      imapConnected,
      imapState,
      processedEmails: processedEmails.size,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      pid: process.pid
    })
  }

  if (pathname === '/api/mail-config') {
    const configFile = path.join(userData, 'config', 'mail.json')
    // GET：只返回非敏感字段 + 「授权码是否已配置」标记，永不回传密码明文
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        email: mailConfig.email || '',
        senderFilter: mailConfig.senderFilter || '',
        pollInterval: mailConfig.pollInterval || 60000,
        imapHost: mailConfig.imap?.host || '',
        imapPort: mailConfig.imap?.port || 993,
        smtpHost: mailConfig.smtp?.host || '',
        smtpPort: mailConfig.smtp?.port || 465,
        passwordSet: Boolean(mailConfig.imap?.auth?.pass || mailConfig.smtp?.auth?.pass),
        configPath: configFile
      })
    }
    // PUT：校验 → 写盘（saveMailConfig）→ 热重载（applyConfig）
    if (req.method === 'PUT') {
      const body = await readJsonBody(req)
      const email = String(body.email || '').trim()
      if (!email) return sendJson(res, 400, { error: '监听邮箱不能为空' })
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJson(res, 400, { error: '监听邮箱格式不正确' })

      const imapPort = Number(body.imapPort)
      const smtpPort = Number(body.smtpPort)
      const validPort = (p) => Number.isInteger(p) && p > 0 && p <= 65535
      if (body.imapPort !== undefined && body.imapPort !== '' && !validPort(imapPort)) {
        return sendJson(res, 400, { error: 'IMAP 端口需为 1-65535 的整数' })
      }
      if (body.smtpPort !== undefined && body.smtpPort !== '' && !validPort(smtpPort)) {
        return sendJson(res, 400, { error: 'SMTP 端口需为 1-65535 的整数' })
      }
      const pollInterval = Number(body.pollInterval)
      if (body.pollInterval !== undefined && body.pollInterval !== '' && (!Number.isFinite(pollInterval) || pollInterval < 1000)) {
        return sendJson(res, 400, { error: '轮询间隔需为 ≥ 1000 的毫秒数' })
      }

      const patch = {
        email,
        senderFilter: String(body.senderFilter ?? '').trim(),
        pollInterval: pollInterval || undefined,
        imapHost: String(body.imapHost ?? '').trim() || undefined,
        imapPort: validPort(imapPort) ? imapPort : undefined,
        smtpHost: String(body.smtpHost ?? '').trim() || undefined,
        smtpPort: validPort(smtpPort) ? smtpPort : undefined,
        password: body.password  // 空/缺省 → saveMailConfig 保留原授权码
      }
      try {
        saveMailConfig(patch)
      } catch (e) {
        return sendJson(res, 500, { error: '保存配置失败: ' + e.message })
      }
      const result = applyConfig()
      return sendJson(res, 200, { ok: true, deferred: result.deferred })
    }
    return sendJson(res, 405, { error: 'Method Not Allowed' })
  }

  if (pathname === '/api/projects' || pathname.startsWith('/api/projects/')) {
    if (req.method === 'GET' && pathname === '/api/projects') {
      return sendJson(res, 200, projects.listProjects())
    }
    if (req.method === 'POST' && pathname === '/api/projects') {
      const body = await readJsonBody(req)
      try {
        projects.addProject(body.name, body.path, body.description || '')
      } catch (e) {
        return sendJson(res, 400, { error: e.message })
      }
      return sendJson(res, 200, projects.listProjects())
    }
    if (req.method === 'PUT' && pathname === '/api/projects/default') {
      const body = await readJsonBody(req)
      try {
        projects.setDefaultProject(body.name)
      } catch (e) {
        return sendJson(res, 400, { error: e.message })
      }
      return sendJson(res, 200, projects.listProjects())
    }
    const delMatch = pathname.match(/^\/api\/projects\/([^/]+)$/)
    if (req.method === 'DELETE' && delMatch) {
      const name = decodeURIComponent(delMatch[1])
      if (!projects.removeProject(name)) {
        return sendJson(res, 404, { error: `未找到项目: ${name}` })
      }
      return sendJson(res, 200, projects.listProjects())
    }
    return sendJson(res, 405, { error: 'Method Not Allowed' })
  }

  if (req.method === 'GET' && pathname === '/api/logs/tail') {
    const lines = Math.min(Math.max(parseInt(u.searchParams.get('lines') || '200', 10) || 200, 1), 1000)
    const logFile = path.join(userData, 'logs', 'gateway.stdout.log')
    try {
      const content = fs.readFileSync(logFile, 'utf8')
      return sendJson(res, 200, { file: logFile, lines, content: content.split('\n').slice(-lines).join('\n') })
    } catch {
      return sendJson(res, 200, { file: logFile, lines: 0, content: '', note: '日志文件不存在（可能非 launchd 启动）' })
    }
  }

  return sendJson(res, 404, { error: 'Not Found' })
}

const healthServer = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${healthPort}`)
  if (u.pathname.startsWith('/api/')) {
    handleApi(req, res, u).catch(err => sendJson(res, 500, { error: err.message }))
    return
  }
  if (req.method === 'GET') return serveStatic(res, u.pathname)
  sendJson(res, 404, { error: 'Not Found' })
})

await new Promise((resolve) => {
  healthServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[mail-gateway] 端口 ${healthPort} 已被占用，可能已有网关实例在运行，退出`)
    } else {
      console.error(`[mail-gateway] 健康检查服务启动失败: ${err.message}`)
    }
    process.exit(1)
  })
  healthServer.listen(healthPort, () => {
    console.log(`[mail-gateway] 健康检查: http://localhost:${healthPort}/api/health`)
    console.log(`[mail-gateway] 管理界面: http://localhost:${healthPort}/`)
    resolve()
  })
})

// ===== 11. 启动邮件网关 =====
// 启动即轮转日志（清理上次遗留的超大日志），之后每 10 分钟检查一次
rotateLogs()
setInterval(rotateLogs, ROTATE_CHECK_MS).unref()
console.log('═══════════════════════════════════════════')
console.log('  星序邮件网关 (MailGateway)')
console.log('═══════════════════════════════════════════')

monitor = createMailMonitor()
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
monitorRunning = true

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
  healthServer.close()
  console.log('✅ 已停止')
  process.exit(0)
})

process.on('SIGTERM', () => {
  monitor.stop()
  healthServer.close()
  process.exit(0)
})
