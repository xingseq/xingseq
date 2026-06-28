/**
 * 虚拟邮箱测试工具定义
 *
 * 仅在 XINGSEQ_VIRTUAL_MAILBOX=1 时建议被星序图调用，用于：
 *   - 模拟外部用户给系统邮箱发邮件（驱动 mail-assistant 收件流程）
 *   - 查询某个虚拟邮箱的收件箱/发件箱（验证 send_email 是否真的送达）
 *   - 重置虚拟邮箱（测试初始化）
 *
 * @created 2026-05-26
 */

export const mockEmailTools = [
  {
    type: 'function',
    function: {
      name: 'mock_email_inject',
      description: '【仅虚拟邮箱模式】把一封邮件直接投递到指定虚拟邮箱的收件箱，模拟"外部用户给系统发邮件"。mail-assistant 在虚拟邮箱模式下会在下一轮轮询时收到并触发完整邮件处理链路（含 Soul Agent 处理与回复）。常用于测试邮件相关星序图。',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: '收件人虚拟邮箱地址，例如 assistant@example.local（即 mail-assistant 监听的账户）'
          },
          from: {
            type: 'string',
            description: '发件人虚拟邮箱地址，例如 user@example.local'
          },
          subject: {
            type: 'string',
            description: '邮件主题'
          },
          body: {
            type: 'string',
            description: '邮件正文'
          }
        },
        required: ['to', 'from', 'subject', 'body']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mock_email_inbox',
      description: '【仅虚拟邮箱模式】查询某个虚拟邮箱的收件箱或发件箱，用于在测试结束后断言"邮件是否真的发出/收到"。',
      parameters: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: '要查询的虚拟邮箱地址'
          },
          box: {
            type: 'string',
            enum: ['inbox', 'sent'],
            description: '查询哪一个邮箱：inbox（收件箱，默认）/ sent（已发送）'
          },
          unreadOnly: {
            type: 'boolean',
            description: '仅返回未读邮件（仅对 inbox 生效），默认 false'
          },
          limit: {
            type: 'number',
            description: '返回的最大条数（按时间倒序之前的最新 N 条），默认 20'
          }
        },
        required: ['address']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mock_email_reset',
      description: '【仅虚拟邮箱模式】清空虚拟邮箱。不传 address 时清空所有虚拟邮箱（用于测试用例之间的隔离）。',
      parameters: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: '要清空的虚拟邮箱地址；为空时清空全部虚拟邮箱'
          }
        }
      }
    }
  }
]
