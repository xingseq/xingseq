/**
 * 文件操作工具定义
 * @author Lioe Squieu
 * @created 2025-11-09
 */

/**
 * 文件操作工具
 */
export const fileTools = [
  {
    type: 'function',
    function: {
      name: 'get_file_content',
      description: '获取文件中的内容。注意：文件大小限制为 2MB，超过将返回错误。如需处理大文件，请使用 codeNode 的 readFileStream 进行流式处理',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件路径'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_file_content',
      description: '设置文件中的内容',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件路径'
          },
          content: {
            type: 'string',
            description: '文件内容'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_file_type',
      description: '检查文件类型：文件、文件夹或不存在',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件或文件夹路径'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_file_string',
      description: '把文件中的某段字符串替换为新的字符串',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件路径'
          },
          old_string: {
            type: 'string',
            description: '需要被替换的旧字符串'
          },
          new_string: {
            type: 'string',
            description: '新字符串'
          }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'download_file',
      description: '从URL下载文件。save_path 支持目录路径（如 /downloads/）或完整文件路径（如 /downloads/file.pdf）',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '下载文件的URL地址'
          },
          save_path: {
            type: 'string',
            description: '保存路径：目录路径（自动解析文件名）或完整文件路径（直接使用）'
          },
          filename: {
            type: 'string',
            description: '自定义文件名（仅当 save_path 为目录时生效）'
          }
        },
        required: ['url', 'save_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_between_strings',
      description: '删除或替换文件中两个字符串之间的内容（包括这两个字符串本身）。传入起始和结束字符串，查找并替换它们之间的所有内容。如果 new_content 为空字符串则为删除操作',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件路径'
          },
          start_string: {
            type: 'string',
            description: '起始字符串（将被包含在替换/删除范围内）'
          },
          end_string: {
            type: 'string',
            description: '结束字符串（将被包含在替换/删除范围内）'
          },
          new_content: {
            type: 'string',
            description: '替换后的新内容。如果为空字符串则删除整个范围',
            default: ''
          }
        },
        required: ['path', 'start_string', 'end_string']
      }
    }
  }
]
