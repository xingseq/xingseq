/**
 * mail-app 独立邮件发送模块
 *
 * 职责：加载 SMTP 配置 → 创建 transporter → 发送一封邮件
 * 被以下场景使用：
 *   1. CLI `mail-app send --to --subject --body`
 *   2. gateway 内部自动回复
 *   3. chat-app send_email 工具（通过子进程调 CLI）
 */

import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// ===== 配置路径 =====
const MAIL_APP_DATA = path.join(os.homedir(), '.xingseq', 'mail-app')
const CONFIG_FILE = path.join(MAIL_APP_DATA, 'config', 'mail.json')
// 兼容旧路径
const LEGACY_CONFIG_FILE = path.join(os.homedir(), '.xingseq', 'chat-app', 'config', 'mail.json')

/**
 * 加载邮件配置（SMTP 部分）
 */
export function loadMailConfig() {
  let fileConfig = {}

  // 优先新路径，fallback 旧路径
  const configPath = fs.existsSync(CONFIG_FILE) ? CONFIG_FILE
    : fs.existsSync(LEGACY_CONFIG_FILE) ? LEGACY_CONFIG_FILE
    : null

  if (configPath) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (err) {
      console.warn(`[mail-app] 配置文件读取失败 (${configPath}): ${err.message}`)
    }
  }

  // 环境变量覆盖
  const env = process.env
  return {
    email: fileConfig.email || env.EMAIL_USER || '',
    senderFilter: fileConfig.senderFilter || env.EMAIL_SENDER_FILTER || '',
    subjectKeywords: fileConfig.subjectKeywords || [],
    pollInterval: Number(fileConfig.pollInterval || env.EMAIL_POLL_INTERVAL || 60000),
    // chat-app 调用方式（此前 gateway 读了这些字段但 loadMailConfig 未返回，恒为默认值）
    chatMode: fileConfig.chatMode || env.MAIL_CHAT_MODE || 'cli',
    chatHost: fileConfig.chatHost || env.MAIL_CHAT_HOST || 'localhost',
    chatPort: Number(fileConfig.chatPort || env.MAIL_CHAT_PORT || 3001),
    // 异步 ack：超过 ackDelaySec 秒仍未处理完，先发「正在处理」回执，跑完再发结果
    ackDelaySec: Number(fileConfig.ackDelaySec ?? env.MAIL_ACK_DELAY_SEC ?? 30),
    // CLI 单次处理硬超时（分钟），需覆盖 qoder_task 多轮调用的最坏情况
    chatTimeoutMin: Number(fileConfig.chatTimeoutMin ?? env.MAIL_CHAT_TIMEOUT_MIN ?? 60),
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

/**
 * 保存邮件配置（合并写入，保留未提供的字段）
 *
 * - 始终以新路径 CONFIG_FILE 落盘（若旧配置在 LEGACY 路径，保存即迁移到新路径）
 * - 文件权限锁 0600（仅本用户可读写），授权码明文存储，与项目现有 config-core
 *   存 API Key 的姿态一致；GUI 层负责「只写不回显」
 * - password 为空/缺省时保留原有授权码不动；非空时同步写入 imap/smtp 的 auth.pass，
 *   并把 auth.user 对齐到 email
 *
 * @param {object} patch 归一化补丁：email/senderFilter/pollInterval/subjectKeywords/
 *                       imapHost/imapPort/smtpHost/smtpPort/password
 * @returns {{success: boolean, path: string}}
 */
export function saveMailConfig(patch = {}) {
  const configPath = fs.existsSync(CONFIG_FILE) ? CONFIG_FILE
    : fs.existsSync(LEGACY_CONFIG_FILE) ? LEGACY_CONFIG_FILE
    : CONFIG_FILE

  let current = {}
  if (fs.existsSync(configPath)) {
    try {
      current = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (err) {
      console.warn(`[mail-app] 现有配置解析失败，将重建 (${configPath}): ${err.message}`)
    }
  }

  const next = { ...current }

  // 顶层非敏感字段（仅覆盖显式提供的）
  if (patch.email !== undefined) next.email = String(patch.email).trim()
  if (patch.senderFilter !== undefined) next.senderFilter = String(patch.senderFilter).trim()
  if (patch.pollInterval !== undefined) next.pollInterval = Number(patch.pollInterval) || 60000
  if (patch.subjectKeywords !== undefined) next.subjectKeywords = patch.subjectKeywords

  // IMAP / SMTP host、port（保留原 auth）
  next.imap = { ...(current.imap || {}) }
  next.smtp = { ...(current.smtp || {}) }
  if (patch.imapHost !== undefined) next.imap.host = String(patch.imapHost).trim()
  if (patch.imapPort !== undefined) next.imap.port = Number(patch.imapPort) || 993
  if (patch.smtpHost !== undefined) next.smtp.host = String(patch.smtpHost).trim()
  if (patch.smtpPort !== undefined) next.smtp.port = Number(patch.smtpPort) || 465

  // 授权码：非空才写；同步 imap/smtp，并把 auth.user 对齐 email
  const password = patch.password
  if (password !== undefined && password !== null && String(password) !== '') {
    const user = next.email || current.imap?.auth?.user || current.smtp?.auth?.user || ''
    next.imap.auth = { ...(current.imap?.auth || {}), user, pass: String(password) }
    next.smtp.auth = { ...(current.smtp?.auth || {}), user, pass: String(password) }
  } else if (next.email) {
    // 未改密码，但 email 变了：确保 auth.user 有值（原值为空时回落到 email）
    if (next.imap.auth) next.imap.auth = { ...next.imap.auth, user: next.imap.auth.user || next.email }
    if (next.smtp.auth) next.smtp.auth = { ...next.smtp.auth, user: next.smtp.auth.user || next.email }
  }

  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 })
  // writeFileSync 的 mode 仅对新建文件生效，已存在文件需显式收紧权限
  try { fs.chmodSync(CONFIG_FILE, 0o600) } catch {}

  return { success: true, path: CONFIG_FILE }
}

/**
 * 发送一封邮件（轻量 SMTP 发送，不依赖 EmailMonitor）
 *
 * @param {object} opts
 * @param {string} opts.to - 收件人
 * @param {string} opts.subject - 主题
 * @param {string} opts.body - 正文（纯文本）
 * @param {string} [opts.html] - HTML 正文（可选）
 * @param {Array} [opts.attachments] - 附件列表 [{path, filename}]
 * @param {object} [opts.config] - 可选，外部传入配置（不读文件）
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendEmail({ to, subject, body, html, attachments, config } = {}) {
  if (!to || !subject || !body) {
    return { success: false, error: '缺少必要参数: to, subject, body' }
  }

  const mailConfig = config || loadMailConfig()
  const smtpAuth = mailConfig.smtp?.auth

  if (!smtpAuth?.user || !smtpAuth?.pass) {
    return {
      success: false,
      error: `SMTP 认证配置不完整。请配置 ${CONFIG_FILE} 或设置 EMAIL_USER/EMAIL_PASSWORD 环境变量`
    }
  }

  try {
    const nodemailer = (await import('nodemailer')).default
    const transporter = nodemailer.createTransport({
      host: mailConfig.smtp.host,
      port: mailConfig.smtp.port,
      secure: mailConfig.smtp.secure,
      auth: {
        user: smtpAuth.user,
        pass: smtpAuth.pass
      }
    })

    const mailOptions = {
      from: `"\u661f\u5e8f AI \u52a9\u624b" <${mailConfig.email || smtpAuth.user}>`,
      to,
      subject,
      text: body,
      html: html || undefined
    }

    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments.map(att => {
        if (typeof att === 'string') return { path: att }
        return att
      })
    }

    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
