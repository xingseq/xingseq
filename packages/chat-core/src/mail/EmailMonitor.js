/**
 * EmailMonitor - 邮件监听模块
 *
 * 迁移自 develop/packages/agent-manager/lib/EmailMonitor.js
 *
 * 监听指定邮箱，过滤发件人/主题，将匹配邮件 emit('email', envelope)。
 * 同时提供 sendEmail 方法用于发送邮件（回复 / 主动发件）。
 *
 * 依赖：imap, mailparser, nodemailer（按需安装）
 */

import { EventEmitter } from 'events'

const DEFAULT_CONFIG = {
  email: '',
  senderFilter: '',
  subjectKeywords: [],
  pollInterval: 60000,
  imap: {
    host: 'imap.qq.com',
    port: 993,
    secure: true,
    auth: { user: '', pass: '' }
  },
  smtp: {
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: { user: '', pass: '' }
  }
}

export class EmailMonitor extends EventEmitter {
  constructor(config = {}) {
    super()

    this.config = { ...DEFAULT_CONFIG, ...config }

    this.running = false
    this.pollTimer = null
    this.lastCheck = null
    this.processedMessageIds = new Set()
    this.dependenciesAvailable = false

    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 5000
    this.reconnectResetDelay = 5 * 60 * 1000
    this.reconnecting = false
    this.reconnectResetTimer = null

    this._depsPromise = this.checkDependencies()
  }

  /**
   * 等待依赖检查完成
   */
  async ready() {
    await this._depsPromise
    return this
  }

  async checkDependencies() {
    try {
      const imapModule = await import('imap')
      const mailparserModule = await import('mailparser')
      const nodemailerModule = await import('nodemailer')

      this.Imap = imapModule.default
      this.simpleParser = mailparserModule.simpleParser
      this.nodemailer = nodemailerModule.default

      this.dependenciesAvailable = true
      console.log('[EmailMonitor] 依赖检查通过')
    } catch (error) {
      console.warn('[EmailMonitor] 依赖不可用:', error.message)
      console.warn('请安装: npm install imap mailparser nodemailer')
      this.dependenciesAvailable = false
    }
  }

  async initializeConnections() {
    if (!this.dependenciesAvailable) {
      throw new Error('EmailMonitor 依赖不可用')
    }

    this.imap = new this.Imap({
      user: this.config.imap.auth.user,
      password: this.config.imap.auth.pass,
      host: this.config.imap.host,
      port: this.config.imap.port,
      tls: this.config.imap.secure,
      tlsOptions: { rejectUnauthorized: false }
    })

    this.transporter = this.nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      auth: {
        user: this.config.smtp.auth.user,
        pass: this.config.smtp.auth.pass
      }
    })

    this.imap.on('ready', () => this.onImapReady())
    this.imap.on('error', (err) => this.onImapError(err))
    this.imap.on('end', () => this.onImapEnd())
  }

  async start() {
    if (this.running) return

    if (!this.dependenciesAvailable) {
      this.emit('error', new Error('EmailMonitor 依赖不可用'))
      return
    }

    if (!this.config.imap.auth.user || !this.config.imap.auth.pass) {
      this.emit('error', new Error('邮箱配置不完整：缺少 IMAP 认证信息'))
      return
    }

    console.log('[EmailMonitor] 启动中...')

    try {
      await this.initializeConnections()
      this.running = true
      this.imap.connect()

      this.pollTimer = setInterval(() => {
        this.checkNewEmails()
      }, this.config.pollInterval)

      console.log(`[EmailMonitor] 已启动，每 ${this.config.pollInterval / 1000} 秒检查一次`)
    } catch (error) {
      console.error('[EmailMonitor] 启动失败:', error)
      this.emit('error', error)
    }
  }

  stop() {
    if (!this.running) return

    console.log('[EmailMonitor] 停止中...')
    this.running = false

    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    if (this.reconnectResetTimer) {
      clearTimeout(this.reconnectResetTimer)
      this.reconnectResetTimer = null
    }

    if (this.imap) {
      try { this.imap.end() } catch (_) { /* ignore */ }
    }

    console.log('[EmailMonitor] 已停止')
  }

  onImapReady() {
    console.log('[EmailMonitor] IMAP 连接就绪')
    this.reconnectAttempts = 0
    this.reconnecting = false
    this.checkNewEmails()
  }

  onImapError(err) {
    if (this.reconnecting) {
      console.log('[EmailMonitor] 重连中的错误，忽略:', err.code || err.message)
      return
    }

    if (err.code === 'EPIPE' || err.message?.includes('socket has been ended')) {
      console.log('[EmailMonitor] 连接被服务器关闭，将重连...')
    } else {
      console.error('[EmailMonitor] IMAP 错误:', err)
      this.emit('error', err)
    }

    if (this.running && !this.reconnecting) {
      this.scheduleReconnect('error')
    }
  }

  onImapEnd() {
    console.log('[EmailMonitor] IMAP 连接结束')
    if (this.running && !this.reconnecting) {
      this.scheduleReconnect('disconnect')
    }
  }

  scheduleReconnect(reason) {
    if (this.reconnecting) return

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(`[EmailMonitor] 达到最大重连次数 (${this.maxReconnectAttempts})，${this.reconnectResetDelay / 1000 / 60} 分钟后重试`)
      this.emit('error', new Error('达到最大重连次数，将稍后重试'))

      if (this.reconnectResetTimer) clearTimeout(this.reconnectResetTimer)

      this.reconnectResetTimer = setTimeout(() => {
        console.log('[EmailMonitor] 重连计数器重置，继续尝试...')
        this.reconnectAttempts = 0
        this.reconnectResetTimer = null
        if (this.running && !this.reconnecting) {
          this.scheduleReconnect('reset-retry')
        }
      }, this.reconnectResetDelay)

      return
    }

    this.reconnecting = true
    this.reconnectAttempts++

    const delay = this.reconnectDelay * this.reconnectAttempts
    console.log(`[EmailMonitor] ${reason}，${delay / 1000}s 后重连 (第 ${this.reconnectAttempts} 次)`)

    setTimeout(() => {
      this.reconnect()
    }, delay)
  }

  async reconnect() {
    if (!this.running) {
      this.reconnecting = false
      return
    }

    console.log('[EmailMonitor] 尝试重连...')

    try {
      if (this.imap) {
        try {
          this.imap.removeAllListeners()
          if (this.imap.state && this.imap.state !== 'disconnected') {
            this.imap.destroy()
          }
        } catch (_) { /* ignore */ }
        this.imap = null
      }

      await new Promise(resolve => setTimeout(resolve, 500))
      await this.initializeConnections()
      this.imap.connect()
    } catch (err) {
      console.error('[EmailMonitor] 重连失败:', err.message)
      this.reconnecting = false
      if (this.running) {
        this.scheduleReconnect('reconnect-failed')
      }
    }
  }

  async checkNewEmails() {
    if (!this.running) return
    if (this.reconnecting) {
      console.log('[EmailMonitor] 重连中，跳过检查')
      return
    }

    if (!this.imap || this.imap.state !== 'authenticated') {
      console.log('[EmailMonitor] IMAP 未连接，触发重连...')
      if (!this.reconnecting) {
        this.scheduleReconnect('not-authenticated')
      }
      return
    }

    console.log('[EmailMonitor] 检查新邮件...')
    this.lastCheck = new Date()

    try {
      this.imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error('[EmailMonitor] 打开收件箱失败:', err)
          return
        }

        this.imap.search(['UNSEEN'], (searchErr, results) => {
          if (searchErr) {
            console.error('[EmailMonitor] 搜索失败:', searchErr)
            return
          }

          if (results.length === 0) {
            console.log('[EmailMonitor] 无新邮件')
            return
          }

          console.log(`[EmailMonitor] 发现 ${results.length} 封新邮件`)

          const fetch = this.imap.fetch(results, {
            bodies: '',
            markSeen: true
          })

          fetch.on('message', (msg, seqno) => {
            this.processEmail(msg, seqno)
          })

          fetch.on('error', (fetchErr) => {
            console.error('[EmailMonitor] 获取邮件失败:', fetchErr)
          })

          fetch.on('end', () => {
            console.log('[EmailMonitor] 邮件获取完成')
          })
        })
      })
    } catch (error) {
      console.error('[EmailMonitor] 检查邮件出错:', error)
    }
  }

  async processEmail(msg, seqno) {
    console.log(`[EmailMonitor] 处理邮件 #${seqno}`)

    let buffer = ''

    msg.on('body', (stream) => {
      stream.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
      })
    })

    msg.on('attributes', (attrs) => {
      const { uid, 'message-id': messageId } = attrs

      if (this.processedMessageIds.has(uid)) {
        console.log(`[EmailMonitor] 邮件 ${uid} 已处理，跳过`)
        return
      }

      msg.on('end', async () => {
        try {
          const parsed = await this.simpleParser(buffer)

          const subject = parsed.subject || ''
          const from = parsed.from?.text || ''
          const to = parsed.to?.text || ''
          const text = parsed.text || ''
          const html = parsed.html || ''
          const date = parsed.date || new Date()

          console.log(`[EmailMonitor] 主题: "${subject}", 发件人: ${from}`)

          const senderFilter = this.config.senderFilter
          const subjectKeywords = this.config.subjectKeywords || []

          const extractEmail = (fromField) => {
            const match = fromField.match(/<([^>]+)>/)
            return match ? match[1].trim().toLowerCase() : fromField.trim().toLowerCase()
          }
          const normalizedFrom = extractEmail(from)
          const normalizedFilter = senderFilter.trim().toLowerCase()
          const isFromTargetSender = senderFilter ? normalizedFrom === normalizedFilter : true
          const containsKeyword = subjectKeywords.length > 0
            ? subjectKeywords.some(keyword => subject.includes(keyword))
            : true

          if (isFromTargetSender && containsKeyword) {
            console.log('[EmailMonitor] 邮件匹配条件，触发事件')

            const agentMessage = {
              type: 'email',
              from,
              to,
              subject,
              content: text || html,
              date: date.toISOString(),
              raw: { uid, messageId, headers: parsed.headers }
            }

            this.processedMessageIds.add(uid)
            this.emit('email', agentMessage)
          } else {
            if (!isFromTargetSender) {
              console.log(`[EmailMonitor] 发件人 ${from} 不匹配过滤条件，忽略`)
            } else if (!containsKeyword) {
              console.log(`[EmailMonitor] 主题不包含关键词，忽略`)
            }
          }
        } catch (parseError) {
          console.error('[EmailMonitor] 解析邮件失败:', parseError)
        }
      })
    })
  }

  /**
   * 发送邮件
   * @param {string} to
   * @param {string} subject
   * @param {string|{text?:string,html?:string}} content
   * @param {object} [options] - { attachments }
   * @returns {Promise<{success, messageId?, error?}>}
   */
  async sendEmail(to, subject, content, options = {}) {
    try {
      const mailOptions = {
        from: this.config.email || this.config.smtp.auth.user,
        to,
        subject,
        text: typeof content === 'object' ? (content.text || '') : (content || ''),
        html: typeof content === 'object' ? content.html : undefined,
        ...options
      }

      if (options.attachments && Array.isArray(options.attachments)) {
        mailOptions.attachments = options.attachments.map(att => {
          if (att.path || att.filename || att.content) return att
          if (typeof att === 'string') return { path: att }
          return att
        })
      }

      const info = await this.transporter.sendMail(mailOptions)
      console.log(`[EmailMonitor] 邮件已发送: ${info.messageId}`)
      return { success: true, messageId: info.messageId, info }
    } catch (error) {
      console.error('[EmailMonitor] 发送失败:', error)
      return { success: false, error: error.message }
    }
  }

  getStatus() {
    return {
      running: this.running,
      dependenciesAvailable: this.dependenciesAvailable,
      lastCheck: this.lastCheck,
      processedCount: this.processedMessageIds.size,
      imapState: this.imap ? this.imap.state : 'not initialized',
      config: {
        email: this.config.email,
        senderFilter: this.config.senderFilter,
        subjectKeywords: this.config.subjectKeywords,
        pollInterval: this.config.pollInterval,
        credentialsConfigured: !!(this.config.imap.auth.user && this.config.imap.auth.pass)
      }
    }
  }

  async deleteEmail(uid) {
    if (!this.running || !this.imap || this.imap.state !== 'authenticated') {
      console.error('[EmailMonitor] IMAP 未连接，无法删除')
      return false
    }

    return new Promise((resolve, reject) => {
      this.imap.openBox('INBOX', false, (err) => {
        if (err) { reject(err); return }

        this.imap.addFlags(uid, ['\\Deleted'], (flagErr) => {
          if (flagErr) { reject(flagErr); return }

          this.imap.expunge((expungeErr) => {
            if (expungeErr) { reject(expungeErr); return }
            console.log(`[EmailMonitor] 邮件 ${uid} 已删除`)
            resolve(true)
          })
        })
      })
    })
  }
}

export default EmailMonitor
