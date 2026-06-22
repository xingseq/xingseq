/**
 * 目录操作工具定义
 * @author Lioe Squieu
 * @created 2025-11-09
 */

/**
 * 目录操作工具
 */
export const directoryTools = [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '遍历指定目录，获取目录下的文件和文件夹列表',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要遍历的目录路径'
          },
          recursive: {
            type: 'boolean',
            description: '是否递归遍历子目录，默认为false',
            default: false
          },
          include_hidden: {
            type: 'boolean',
            description: '是否包含隐藏文件（以.开头的文件），默认为false',
            default: false
          },
          file_types: {
            type: 'array',
            items: { type: 'string' },
            description: '文件扩展名过滤器，例如[".js", ".jsx"]，为空则返回所有文件'
          },
          max_results: {
            type: 'integer',
            description: '最大返回结果数，默认为50',
            default: 50
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'directory_summary',
      description: '快速统计目录信息，返回文件数量统计而不返回详细列表，节省token',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要统计的目录路径'
          },
          recursive: {
            type: 'boolean',
            description: '是否递归统计子目录，默认为false',
            default: false
          },
          group_by_extension: {
            type: 'boolean',
            description: '是否按文件扩展名分组统计，默认为true',
            default: true
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: '在指定目录中搜索符合条件的文件',
      parameters: {
        type: 'object',
        properties: {
          search_path: {
            type: 'string',
            description: '搜索的根目录路径'
          },
          filename_pattern: {
            type: 'string',
            description: '文件名搜索模式（支持通配符*和?）'
          },
          content_pattern: {
            type: 'string',
            description: '文件内容搜索模式（可选）'
          },
          file_types: {
            type: 'array',
            items: { type: 'string' },
            description: '文件扩展名过滤器，例如[".js", ".txt"]'
          },
          max_results: {
            type: 'integer',
            description: '最大返回结果数，默认为100',
            default: 100
          }
        },
        required: ['search_path']
      }
    }
  }
]
