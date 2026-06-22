/**
 * 自定义AI模型工具定义
 * @author Lioe Squieu
 * @created 2025-11-16
 */

export const customModelTools = [
  {
    type: 'function',
    function: {
      name: 'create_custom_model',
      description: '创建一个新的自定义AI模型配置。可以配置模型的名称、提供商、子模型、温度参数、系统提示词、标签和工作目录等。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '自定义模型的名称，例如"编程助手"、"文案创作"等'
          },
          provider: {
            type: 'string',
            description: '模型提供商ID，从已配置的模型中选择，例如"deepseek-default"'
          },
          subModel: {
            type: 'string',
            description: '具体的子模型名称，例如"deepseek-v4-flash"、"deepseek-v4-pro"等。如果不指定，将使用提供商的默认模型"deepseek-v4-pro"'
          },
          temperature: {
            type: 'number',
            description: '温度参数，控制输出的随机性，范围0-1，默认0.7。较低的值使输出更确定，较高的值使输出更有创造性',
            default: 0.7
          },
          stream: {
            type: 'boolean',
            description: '是否使用流式输出，默认false',
            default: true
          },
          systemPrompt: {
            type: 'string',
            description: '系统提示词，定义AI的角色和行为。例如"你是一个专业的Python编程助手"'
          },
          tags: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: '标签列表，用于分类和筛选模型。例如["编程", "Python"]'
          },
          workingDirectory: {
            type: 'string',
            description: '工作目录路径，AI在执行任务时的默认目录'
          },
          useTools: {
            type: 'boolean',
            description: '是否允许模型使用系统工具（如文件操作、数据库操作等），默认true',
            default: true
          }
        },
        required: ['name', 'provider']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_custom_models',
      description: '获取所有自定义AI模型的名称列表。可以用于了解当前已配置的自定义模型。',
      parameters: {
        type: 'object',
        properties: {
          include_details: {
            type: 'boolean',
            description: '是否包含详细信息（provider、subModel、temperature等），默认false只返回名称',
            default: false
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_custom_model',
      description: '根据ID或名称获取指定自定义AI模型的详细配置信息。',
      parameters: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: '模型的ID或名称'
          }
        },
        required: ['identifier']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_custom_model',
      description: '更新现有的自定义AI模型配置。可以修改模型的任何配置项。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '要更新的模型ID'
          },
          name: {
            type: 'string',
            description: '新的模型名称'
          },
          provider: {
            type: 'string',
            description: '新的模型提供商ID'
          },
          subModel: {
            type: 'string',
            description: '新的子模型名称'
          },
          temperature: {
            type: 'number',
            description: '新的温度参数'
          },
          stream: {
            type: 'boolean',
            description: '是否使用流式输出'
          },
          systemPrompt: {
            type: 'string',
            description: '新的系统提示词'
          },
          tags: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: '新的标签列表'
          },
          workingDirectory: {
            type: 'string',
            description: '新的工作目录路径'
          },
          useTools: {
            type: 'boolean',
            description: '是否允许模型使用系统工具'
          }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_custom_model_params',
      description: '根据模型ID更新指定自定义AI模型的参数。只更新提供的参数，未提供的参数保持不变。适用于快速调整模型配置。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '要更新的模型ID（必填）'
          },
          temperature: {
            type: 'number',
            description: '温度参数，控制输出的随机性，范围0-1。较低的值使输出更确定，较高的值使输出更有创造性'
          },
          stream: {
            type: 'boolean',
            description: '是否使用流式输出'
          },
          systemPrompt: {
            type: 'string',
            description: '系统提示词，定义AI的角色和行为'
          },
          workingDirectory: {
            type: 'string',
            description: '工作目录路径，AI在执行任务时的默认目录'
          },
          useTools: {
            type: 'boolean',
            description: '是否允许模型使用系统工具'
          }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_custom_model',
      description: '删除指定的自定义AI模型配置。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '要删除的模型ID'
          }
        },
        required: ['id']
      }
    }
  }
]
