/**
 * 定时器工具定义 - 为 AI 提供定时任务能力
 * @author AI Assistant
 * @created 2026-03-31
 */

export const timerTools = [
  {
    type: 'function',
    function: {
      name: 'set_timer',
      description: '设置定时任务。支持一次性延迟执行或 cron 周期任务。到期后会通知指定的 Agent。返回 timer_id（唯一标识）、名称、类型和执行时间，建议记住 timer_id 以便后续匹配定时器触发通知。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '定时任务名称，用于标识和管理（建议简短有意义）'
          },
          delay: {
            type: 'string',
            description: '延迟时间，支持格式：30s（秒）、5m（分钟）、2h（小时）、1d（天）。与 cron 二选一'
          },
          cron: {
            type: 'string',
            description: 'Cron 表达式，用于周期任务。格式：秒 分 时 日 月 周。例如 "0 0 9 * * *" 表示每天9点。与 delay 二选一'
          },
          target_agent: {
            type: 'string',
            description: '到期后通知的目标 Agent 名称，如 "agent" 等'
          },
          message: {
            type: 'string',
            description: '到期后发送给目标 Agent 的消息内容'
          },
          once: {
            type: 'boolean',
            description: '是否为一次性任务。delay 模式默认 true，cron 模式默认 false'
          },
          enabled: {
            type: 'boolean',
            description: '是否立即启用，默认 true'
          },
          reply_to: {
            type: 'string',
            description: '定时任务到期后，回复消息应发送到的目标通道（如 "gui-agent"、"cli-user"、"chatroom-xxx"）。可选，默认由 Butler 自主决定发送目标'
          }
        },
        required: ['name', 'target_agent', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cancel_timer',
      description: '取消指定的定时任务',
      parameters: {
        type: 'object',
        properties: {
          timer_id: {
            type: 'string',
            description: '定时任务 ID（创建时返回）或任务名称'
          }
        },
        required: ['timer_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_timers',
      description: '列出所有定时任务及其状态',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['all', 'active', 'paused', 'completed'],
            description: '筛选状态，默认 "all"'
          },
          target_agent: {
            type: 'string',
            description: '按目标 Agent 筛选'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'pause_timer',
      description: '暂停指定的定时任务（仅对周期任务有效）',
      parameters: {
        type: 'object',
        properties: {
          timer_id: {
            type: 'string',
            description: '定时任务 ID 或任务名称'
          }
        },
        required: ['timer_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resume_timer',
      description: '恢复暂停的定时任务',
      parameters: {
        type: 'object',
        properties: {
          timer_id: {
            type: 'string',
            description: '定时任务 ID 或任务名称'
          }
        },
        required: ['timer_id']
      }
    }
  }
]
