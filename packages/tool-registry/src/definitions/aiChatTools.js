/**
 * AI对话工具定义 - 允许AI在执行任务时开启子对话
 * @author Lioe Squieu
 * @created 2025-11-15
 */

export const aiChatTools = [
  {
    type: 'function',
    function: {
      name: 'start_ai_chat',
      description: '开启一个新的AI对话，可用于获取AI的分析、建议或处理复杂任务。你可以传入系统提示词来指定AI的角色和任务，传入上下文信息帮助AI更好地理解问题。适用场景：代码分析、方案设计、数据处理、问题诊断等需要AI协助的任务。',
      parameters: {
        type: 'object',
        properties: {
          system_prompt: {
            type: 'string',
            description: '系统提示词，用于指定AI的角色、任务和行为规范。例如："你是一个资深的代码审查专家，请分析代码质量并提出改进建议"'
          },
          user_message: {
            type: 'string',
            description: '用户消息，描述需要AI处理的具体问题或任务'
          },
          context: {
            type: 'string',
            description: '上下文信息（可选），可以包含文件内容、代码片段、数据样本等帮助AI理解问题的补充信息'
          },
          mode: {
            type: 'string',
            enum: ['chat', 'reasoner'],
            description: 'AI模式：\n- chat: 普通聊天模式，响应快速\n- reasoner: 深度思考模式，适合复杂问题分析（默认）'
          },
          temperature: {
            type: 'number',
            description: '温度参数（0-2），控制回复的随机性。较低值（如0.3）更确定和聚焦，较高值（如1.5）更有创造性。默认为1.0'
          },
          use_tools: {
            type: 'boolean',
            description: '是否启用工具调用（默认false）。设为true时，子对话可以调用其他工具来完成任务。注意：启用工具调用可能增加响应时间和API调用次数'
          }
        },
        required: ['user_message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'chat_with_custom_model',
      description: '使用指定的自定义模型进行对话。极简调用方式，只需传入模型ID和消息内容，模型的系统提示词、温度、工具调用等配置将自动从自定义模型设置中读取。',
      parameters: {
        type: 'object',
        properties: {
          model_id: {
            type: 'string',
            description: '自定义模型的ID。可通过 list_custom_models 工具获取所有可用的自定义模型列表'
          },
          message: {
            type: 'string',
            description: '发送给AI的消息内容'
          },
          context: {
            type: 'string',
            description: '附加上下文信息（可选），如代码片段、文件内容等'
          }
        },
        required: ['model_id', 'message']
      }
    }
  }
]
