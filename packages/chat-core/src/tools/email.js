/**
 * chat-core 邮件工具组
 *
 * 工具：
 *   - send_email(to, subject, body, attachments?)  主动发邮件
 *
 * 发送方式：
 *   1. 直接注入 sendFn（mail-app gateway 内部使用）
 *   2. CLI 模式：通过子进程调 `mail-app send` CLI（chat-app 等外部应用使用）
 *
 * 安全：send_email 在 DEFAULT_SENSITIVE_TOOLS 中，走确认流程
 */

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// mail-app CLI 的路径（相对于 monorepo 根目录）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MAIL_APP_CLI = path.resolve(__dirname, '../../../../apps/mail-app/src/cli.mjs')

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
 * 通过 mail-app CLI 发邮件（子进程方式）
 * 供 chat-app 等外部应用使用
 */
function createCliSendFn(cliPath = MAIL_APP_CLI) {
  return (to, subject, body, options = {}) => {
    return new Promise((resolve) => {
      const args = ['send', '--to', to, '--subject', subject, '--body', body]
      if (options.attachments && options.attachments.length > 0) {
        args.push('--attachments', JSON.stringify(options.attachments))
      }

      execFile('node', [cliPath, ...args], {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      }, (err, stdout, stderr) => {
        if (err) {
          // 尝试从 stdout 解析 JSON 错误
          try {
            const result = JSON.parse(stdout || stderr)
            resolve(result)
          } catch {
            resolve({ success: false, error: err.message })
          }
          return
        }
        try {
          resolve(JSON.parse(stdout.trim()))
        } catch {
          resolve({ success: false, error: `mail-app CLI 输出无法解析: ${stdout}` })
        }
      })
    })
  }
}

/**
 * 创建邮件工具处理器
 *
 * @param {object} opts
 * @param {Function} [opts.sendFn] - 发邮件函数（可选）
 *   - 提供时：直接调用（mail-app gateway 内部场景）
 *   - 不提供时：自动通过 mail-app CLI 子进程发送
 * @param {string} [opts.cliPath] - mail-app CLI 路径（仅 CLI 模式生效）
 */
export function createEmailHandlers({ sendFn, cliPath } = {}) {
  const actualSendFn = sendFn || createCliSendFn(cliPath)

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

      const result = await actualSendFn(to, subject, body, options)

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

export { createCliSendFn }
