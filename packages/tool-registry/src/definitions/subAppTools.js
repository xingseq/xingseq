/**
 * 子应用工具定义 - 提供调用已注册子应用的能力
 * @author Lioe Squieu
 * @created 2026-02-07
 */

export const subAppTools = [
  {
    type: 'function',
    function: {
      name: 'list_sub_apps',
      description: '列出所有已注册的子应用及其可用命令。返回每个子应用的名称、描述、CLI命令等信息。',
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
      name: 'execute_sub_app_command',
      description: '执行子应用的 CLI 命令。args 参数必须是对象格式（键值对），不能是数组或字符串。',
      parameters: {
        type: 'object',
        properties: {
          app_name: {
            type: 'string',
            description: '子应用名称，如 "png-to-ico"、"email-cli" 等'
          },
          command: {
            type: 'string',
            description: '要执行的命令名称，如 "convert"、"send" 等'
          },
          args: {
            type: 'object',
            description: '命令参数对象（必须是对象格式，不能是数组）。示例：{"input": "/path/to/file.png", "output": "/path/to/output.ico"} 或 {"to": "user@example.com", "subject": "主题", "body": "内容"}',
            additionalProperties: true
          }
        },
        required: ['app_name', 'command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_sub_app_info',
      description: '获取指定子应用的详细信息，包括可用命令、参数说明等。',
      parameters: {
        type: 'object',
        properties: {
          app_name: {
            type: 'string',
            description: '子应用名称'
          }
        },
        required: ['app_name']
      }
    }
  }
]
