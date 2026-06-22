/**
 * 文件管理工具定义
 * @author Lioe Squieu
 * @created 2025-11-09
 */

/**
 * 文件管理工具（复制、移动等）
 */
export const fileManagementTools = [
  {
    type: 'function',
    function: {
      name: 'copy_file',
      description: '复制文件或目录到指定位置',
      parameters: {
        type: 'object',
        properties: {
          source_path: {
            type: 'string',
            description: '源文件或目录路径'
          },
          destination_path: {
            type: 'string',
            description: '目标路径'
          },
          overwrite: {
            type: 'boolean',
            description: '如果目标文件存在是否覆盖，默认为false',
            default: false
          }
        },
        required: ['source_path', 'destination_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_file',
      description: '移动文件或目录到指定位置',
      parameters: {
        type: 'object',
        properties: {
          source_path: {
            type: 'string',
            description: '源文件或目录路径'
          },
          destination_path: {
            type: 'string',
            description: '目标路径'
          },
          overwrite: {
            type: 'boolean',
            description: '如果目标文件存在是否覆盖，默认为false',
            default: false
          }
        },
        required: ['source_path', 'destination_path']
      }
    }
  }
]
