/**
 * 个人信息检索打包工具定义 - 搜索个人信息并打包为加密 ZIP
 * @author Lioe Squieu
 * @created 2026-04-09
 */

export const zhmmTools = [
  {
    type: 'function',
    function: {
      name: 'zhmm_zip',
      description: '搜索个人信息并打包为加密 ZIP 文件。基于 zhmm_cmd 执行关键词搜索，将匹配结果打包为加密压缩包。典型用途：用户通过邮件远程请求查询个人信息时，调用此工具生成 ZIP，再通过 send_email 附件发送给用户。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '搜索关键词，传给 zhmm_cmd --search 进行信息检索'
          },
          output_path: {
            type: 'string',
            description: '输出 ZIP 文件的完整路径。可选，默认输出到系统临时目录（如 /tmp/zhmm_result_<timestamp>.zip）'
          }
        },
        required: ['keyword']
      }
    }
  }
]
