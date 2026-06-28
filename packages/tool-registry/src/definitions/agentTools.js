/**
 * Agent 管理工具定义 - 提供 AI Agent 生命周期管理能力
 * @author Lioe Squieu
 * @created 2026-02-12
 * @updated 2026-02-20 添加 execute_subtasks 工具
 */

export const agentTools = [
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: '通过 GUI 弹窗向用户提问并等待回答。支持单选、多选、确认（是/否）、文本输入四种交互类型。适用于 AI 推理过程中需要用户做出选择或提供信息的场景。弹窗带有倒计时，超时后自动使用默认值。',
      parameters: {
        type: 'object',
        properties: {
          promptType: {
            type: 'string',
            enum: ['single_choice', 'multi_choice', 'confirm', 'text_input'],
            description: '交互类型：single_choice(单选)、multi_choice(多选)、confirm(是/否确认)、text_input(文本输入)'
          },
          title: {
            type: 'string',
            description: '弹窗标题，简洁描述问题'
          },
          message: {
            type: 'string',
            description: '详细说明，向用户解释为什么需要做出选择以及各选项的含义'
          },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: '选项标签' },
                description: { type: 'string', description: '选项描述（可选）' }
              },
              required: ['label']
            },
            description: '选项列表，仅 single_choice 和 multi_choice 类型需要提供'
          },
          defaultValue: {
            type: 'string',
            description: '超时后的默认值。单选/确认填选项label或"yes"/"no"，多选填逗号分隔的label，文本输入填默认文本'
          },
          timeoutSeconds: {
            type: 'integer',
            description: '超时秒数，默认 60 秒。超时后自动使用 defaultValue'
          }
        },
        required: ['promptType', 'title', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_message_to_agent',
      description: '向指定的 Agent 发送消息。用于 Agent 之间的通信，如委托任务、请求协作等。',
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: '发送者 Agent 名称（必须指定，用于接收回复）。例如 "agent"'
          },
          to: {
            type: 'string',
            description: '目标 Agent 名称，如 "gui-agent"、"planner"、"executor" 等'
          },
          message: {
            type: 'string',
            description: '要发送的消息内容'
          },
          type: {
            type: 'string',
            enum: ['task', 'query', 'notify'],
            description: '消息类型：task(委托任务)、query(查询)、notify(通知)，默认 task'
          }
        },
        required: ['from', 'to', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_subtasks',
      description: '将复杂任务分解为多个独立子任务并行执行。每个子任务在隔离的上下文中独立完成（可调用工具、进行思考等），最终只返回结果。适用于：需要多步骤处理的复杂任务、需要分摊上下文压力的长任务。注意：简单任务无需分解，直接完成即可。',
      parameters: {
        type: 'object',
        properties: {
          subtasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: '子任务名称，用于标识和日志记录'
                },
                task: {
                  type: 'string',
                  description: '子任务的完整描述。需要包含足够的上下文让子任务可以独立完成，不要假设子任务知道主任务的背景'
                },
                context: {
                  type: 'string',
                  description: '可选的额外上下文信息，如文件路径、相关数据等'
                }
              },
              required: ['name', 'task']
            },
            description: '子任务列表。每个子任务会在独立上下文中执行，完成后只返回结果'
          },
          parallel: {
            type: 'boolean',
            description: '是否并行执行子任务，默认 false（串行执行）。并行执行更快，但子任务之间不能有依赖关系'
          }
        },
        required: ['subtasks']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_agents',
      description: '列出所有已注册的 AI Agent 及其运行状态。返回每个 Agent 的名称、模式、状态（running/stopped）、PID、运行时间等信息。',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_agent',
      description: '获取指定 Agent 的详细信息，包括配置、运行状态、启动时间等。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Agent 名称'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'start_agent',
      description: '启动一个 AI Agent。可以指定对话模式、是否启用工具调用、联网搜索等选项。Agent 将以后台守护进程方式运行。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Agent 名称，用于标识和管理'
          },
          mode: {
            type: 'string',
            enum: ['chat', 'reasoner'],
            description: '对话模式：chat（普通聊天）或 reasoner（深度思考），默认 chat'
          },
          tools: {
            type: 'boolean',
            description: '是否启用工具调用（Function Calling），默认 false'
          },
          search: {
            type: 'boolean',
            description: '是否启用联网搜索，默认 false'
          },
          system_prompt: {
            type: 'string',
            description: '自定义系统提示词，用于指定 Agent 的角色和行为'
          },
          description: {
            type: 'string',
            description: 'Agent 描述信息'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'stop_agent',
      description: '停止一个正在运行的 Agent。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Agent 名称'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_agent_status',
      description: '获取指定 Agent 的运行状态，包括 PID、运行时间、是否为守护进程等。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Agent 名称'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_agent_logs',
      description: '读取指定 Agent 的运行日志。可以指定读取的行数。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Agent 名称'
          },
          tail: {
            type: 'integer',
            description: '读取最后 N 行日志，默认 50'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remove_agent',
      description: '移除一个 Agent（停止运行并注销）。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Agent 名称'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_agent_templates',
      description: '列出所有可用的 Agent 工作流模板。模板可用于快速创建预定义的 Agent 工作流配置。',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_agent_workflow',
      description: '执行一个 Agent 工作流配置（YAML 格式）。支持多 Agent 协作、任务编排等高级功能。',
      parameters: {
        type: 'object',
        properties: {
          yaml_content: {
            type: 'string',
            description: 'YAML 格式的工作流配置内容'
          },
          vars: {
            type: 'object',
            description: '工作流变量，用于替换配置中的占位符',
            additionalProperties: true
          },
          dry_run: {
            type: 'boolean',
            description: '是否为试运行模式（不实际执行），默认 false'
          }
        },
        required: ['yaml_content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cleanup_agents',
      description: '清理过期的 Agent PID 文件。用于清理已停止但残留的进程信息。',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'restart_agent',
      description: '重启一个 AI Agent。支持两种模式：1) 直接重启：停止当前进程后重新启动；2) 升级重启：备份当前脚本，替换为新脚本后启动，失败时自动回滚。适用于 agent 自我升级或热重启场景。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Agent 名称（如 agent）'
          },
          new_script: {
            type: 'string',
            description: '可选。新脚本文件的绝对路径。如果提供，将进行升级重启：备份当前脚本 -> 替换为新脚本 -> 启动。如果启动失败，会自动回滚到旧版本。'
          }
        },
        required: ['name']
      }
    }
  }
]
