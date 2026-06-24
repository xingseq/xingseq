/**
 * chat-core 邮件工具组
 *
 * 迁移自 develop/electron/tools/definitions/emailTools.js + emailExecutor.js
 *
 * 简化：源项目通过 IPC → AgentCommunication → mail-assistant 发邮件，
 * 我们同进程直接调 sendFn（由 MailGateway 注入 EmailMonitor.sendEmail）。
 *
 * 工具：
 *   - send_email(to, subject, body, attachments?)  主动发邮件
 *
 * 安全：send_email 在 DEFAULT_SENSITIVE_TOOLS 中，走确认流程
 */

export const sendEmailTool = {
  type: 'function',
  function: {
    name: 'send_email',
    description: '主动发送一封新邮件。适用于：主动通知用户、发送任务报告、发送提醒等。',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: '收件人邮箱地址，例如 "user@example.com"'
        },
        subject: {
          type: 'string',
          description: '邮件主题'
        },
        body: {
          type: 'string',
          description: '邮件正文内容（纯文本）'
        },
        attachments: {
          type: 'array',
          description: '附件列表，每个附件包含 path（文件路径）和 filename（文件名）',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '附件文件的完整路径' },
              filename: { type: 'string', description: '邮件中显示的文件名（可选）' }
            }
          }
        }
      },
      required: ['to', 'subject', 'body']
    }
  }
}

export const EMAIL_TOOLS = [sendEmailTool]

/**
 * 创建邮件工具处理器
 *
 * @param {object} opts
 * @param {Function} opts.sendFn - 发邮件函数：(to, subject, body, options) => Promise<{success, messageId?, error?}>
 *                                  通常由 MailGateway 注入 EmailMonitor.sendEmail
 */
export function createEmailHandlers({ sendFn } = {}) {
  if (typeof sendFn !== 'function') {
    throw new Error('createEmailHandlers: sendFn 必填（EmailMonitor.sendEmail 或等价函数）')
  }

  return {
    send_email: async (args = {}) => {
      const { to, subject, body, attachments } = args

      if (!to || !subject || !body) {
        throw new Error('缺少必要参数: to(收件人)、subject(主题)、body(正文)')
      }

      if (!to.includes('@')) {
        throw new Error(`收件人邮箱格式无效: ${to}`)
      }

      const options = {}
      if (attachments && attachments.length > 0) {
        options.attachments = attachments
      }

      const result = await sendFn(to, subject, body, options)

      if (!result.success) {
        throw new Error(`邮件发送失败: ${result.error || '未知错误'}`)
      }

      return {
        message: `邮件已发送 → ${to}`,
        to,
        subject,
        attachments: attachments?.length || 0,
        messageId: result.messageId
      }
    }
  }
}
