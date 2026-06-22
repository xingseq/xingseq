/**
 * 命令执行工具定义
 * @author Lioe Squieu
 * @created 2025-11-09
 * @updated 2026-03-20 添加应用启动工具
 */

/**
 * 命令执行工具
 */
export const commandTools = [
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: '执行安全的系统命令（仅限白名单命令）。支持 Windows 和 macOS 平台。出于安全考虑，仅允许执行预定义的安全命令，如 npm、git、make 等开发工具命令',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的命令（如 npm、git、make 等）'
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: '命令参数数组，例如 ["install", "--save"]'
          },
          cwd: {
            type: 'string',
            description: '命令执行的工作目录路径（可选），默认为当前项目目录'
          },
          timeout: {
            type: 'integer',
            description: '命令执行超时时间（毫秒），默认为 30000（30秒），最大不超过 300000（5分钟）',
            default: 30000
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'launch_application',
      description: '启动用户配置的应用程序（如音乐播放器、浏览器等）。出于安全考虑，只能启动用户预先配置在可执行程序白名单中的应用，或位于安全目录内的程序',
      parameters: {
        type: 'object',
        properties: {
          executable: {
            type: 'string',
            description: '可执行程序的完整路径，例如 "C:\\\\Program Files\\\\Spotify\\\\Spotify.exe" 或 "/Applications/Spotify.app/Contents/MacOS/Spotify"'
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: '启动参数数组（可选），例如 ["--minimized"]'
          },
          detached: {
            type: 'boolean',
            description: '是否以分离模式启动（后台运行），默认为 true',
            default: true
          }
        },
        required: ['executable']
      }
    }
  }
]
