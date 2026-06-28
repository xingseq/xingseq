/**
 * 授权工具定义 - 仅包含 CLI 可安全使用的工具
 * @author Lioe Squieu
 * @created 2026-03-22
 * @updated 2026-03-28 移除需要 GUI 的授权请求工具
 * 
 * 注意：需要 GUI 弹窗确认的授权请求工具（如 request_executable_authorization）
 * 不在此处定义，因为 agent (CLI) 无法使用 GUI 功能。
 * 授权请求应由 GUI Agent 通过 IPC 处理。
 */

export const authorizationTools = [
  {
    type: 'function',
    function: {
      name: 'get_current_authorizations',
      description: '获取当前已授权的路径、程序和命令模式列表。用于查看当前有哪些权限可用。',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['paths', 'executables', 'commands', 'all'],
            description: '要查询的授权类型（默认all）:\n- paths: 已授权的安全路径\n- executables: 已授权的可执行程序\n- commands: 命令模式状态\n- all: 全部授权信息'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reload_security_paths',
      description: '重新加载安全路径配置。当用户通过 GUI 授权新的路径后，调用此工具来刷新内存中的权限配置，使新授权立即生效。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
]
