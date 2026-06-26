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
