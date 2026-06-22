/**
 * 邮件工具定义 - 提供主动发送邮件能力
 * @author Lioe Squieu
 * @created 2026-04-06
 */

export const emailTools = [
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: '主动发送一封新邮件。通过邮件助手（mail-assistant）的 SMTP 通道发送，无需依赖已有邮件。适用于：主动通知用户、发送任务报告、发送提醒等场景。注意：需要邮件助手处于运行状态。',
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
                path: {
                  type: 'string',
                  description: '附件文件的完整路径'
                },
                filename: {
                  type: 'string',
                  description: '邮件中显示的文件名（可选，默认从路径提取）'
                }
              }
            }
          }
        },
        required: ['to', 'subject', 'body']
      }
    }
  }
]
