/**
 * MockEmailMonitor - 虚拟邮箱后端
 *
 * 迁移自 develop/packages/agent-manager/lib/MockEmailMonitor.js
 *
 * 行为兼容 EmailMonitor：
 *   - 继承 EventEmitter，emit('email', envelope)、emit('error', err)
 *   - dependenciesAvailable: true（不依赖 imap/nodemailer）
 *   - start()/stop()/sendEmail()/checkMail()/checkNewEmails()/deleteEmail()
 *
 * 数据通过 VirtualMailboxStore 持久化。本对象代表"当前账户"的视角，
 * 启动后周期性扫描自己的 inbox.json，把未读邮件标记为已读并 emit('email')。
 */

import { EventEmitter } from 'events'
import * as Store from './VirtualMailboxStore.js'

const DEFAULTS = {
  email: '',
  senderFilter: '',
  subjectKeywords: [],
  pollInterval: 2000,
  imap: { auth: { user: '', pass: '' } },
  smtp: { auth: { user: '', pass: '' } }
}

export class MockEmailMonitor extends EventEmitter {
  constructor(config = {}) {
    super()
    this.config = { ...DEFAULTS, ...config }
    this.account = (this.config.imap?.auth?.user || this.config.email || '').trim()

    this.running = false
    this.pollTimer = null
    this.lastUid = 0
    this.dependenciesAvailable = true
  }

  async checkDependencies() { this.dependenciesAvailable = true }
  async initializeConnections() { /* 无需真实连接 */ }
  onImapReady() {}
  onImapError() {}
  onImapEnd() {}

  async start() {
    if (this.running) return
    if (!this.account) {
      this.emit('error', new Error('MockEmailMonitor 启动失败：未指定监听账户'))
      return
    }

    this.running = true
    console.log(`[MockMailbox] 启动虚拟邮箱监听: ${this.account} (轮询 ${this.config.pollInterval}ms)`)

    await this.checkNewEmails()
    this.pollTimer = setInterval(() => {
      this.checkNewEmails().catch(err => this.emit('error', err))
    }, this.config.pollInterval)
  }

  stop() {
    this.running = false
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    console.log(`[MockMailbox] 停止虚拟邮箱监听: ${this.account}`)
  }

  async checkMail() { return this.checkNewEmails() }

  async checkNewEmails() {
    if (!this.running) return
    let unread
    try {
      unread = await Store.listInbox(this.account, { unreadOnly: true })
    } catch (err) {
      this.emit('error', err)
      return
    }
    if (!unread || unread.length === 0) return

    for (const mail of unread) {
      const sender = String(mail.from || '').toLowerCase()
      const senderFilter = String(this.config.senderFilter || '').trim().toLowerCase()
      if (senderFilter) {
        const m = sender.match(/<([^>]+)>/)
        const norm = (m ? m[1] : sender).trim()
        if (norm !== senderFilter) {
          await Store.markRead(this.account, mail.uid)
          continue
        }
      }
      const keywords = this.config.subjectKeywords || []
      if (keywords.length > 0) {
        const subj = String(mail.subject || '')
        if (!keywords.some(k => subj.includes(k))) {
          await Store.markRead(this.account, mail.uid)
          continue
        }
      }

      const agentMessage = {
        type: 'email',
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        content: mail.content,
        date: mail.date,
        raw: { uid: mail.uid, messageId: mail.messageId, headers: {} }
      }

      await Store.markRead(this.account, mail.uid)
      if (mail.uid > this.lastUid) this.lastUid = mail.uid

      this.emit('email', agentMessage)
    }
  }

  /**
   * 发送邮件 = 投递到收件人虚拟邮箱 + 自己 sent 留底
   */
  async sendEmail(to, subject, content, options = {}) {
    try {
      const body = (typeof content === 'object' && content) ? (content.text || content.html || '') : content
      const { delivered, envelope } = await Store.deliver({
        from: this.account,
        to,
        subject,
        content: body,
        attachments: options.attachments || [],
        metadata: options.metadata || {}
      })
      await Store.recordSent(this.account, envelope)
      console.log(`[MockMailbox] ${this.account} → ${delivered.join(',')} | ${subject}`)
      return {
        success: true,
        messageId: envelope.messageId,
        info: { delivered, accepted: delivered, rejected: [] }
      }
    } catch (err) {
      console.error('[MockMailbox] sendEmail 失败:', err.message)
      return { success: false, error: err.message }
    }
  }

  async deleteEmail(uid) {
    return Store.deleteMail(this.account, Number(uid))
  }

  getStatus() {
    return {
      running: this.running,
      dependenciesAvailable: this.dependenciesAvailable,
      lastCheck: null,
      processedCount: 0,
      imapState: 'mock',
      config: {
        email: this.account,
        senderFilter: this.config.senderFilter,
        subjectKeywords: this.config.subjectKeywords,
        pollInterval: this.config.pollInterval,
        credentialsConfigured: true
      }
    }
  }
}

export default MockEmailMonitor
