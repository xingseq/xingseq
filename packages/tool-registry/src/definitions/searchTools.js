/**
 * 联网搜索工具定义
 * @author Lioe Squieu
 * @created 2025-12-28
 * 
 * 说明：不向 LLM 暴露搜索源（source）参数，
 * 由执行器根据用户配置的 API Key 按优先级自动选择合适的搜索 API
 * (Tavily > SerpAPI > DuckDuckGo)
 */

export const searchTools = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '在互联网上搜索实时信息。当用户询问需要最新数据、时事新闻、实时信息等内容时使用此工具。搜索源由系统根据用户配置的 API Key 自动选择，无需指定。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索查询词，应该简洁明确，突出关键信息'
          },
          max_results: {
            type: 'number',
            description: '最大返回结果数量，默认为5，最大为10'
          },
          region: {
            type: 'string',
            description: '搜索区域，如 cn-zh（中国中文）、us-en（美国英语），默认自动'
          },
          china_domains: {
            type: 'boolean',
            description: '是否限定搜索国内网站（知乎、CSDN、B站、微博等），默认 false。当用户明确要求搜索国内内容时设为 true'
          }
        },
        required: ['query']
      }
    }
  }
]

/**
 * 搜索Agent专用的系统提示词
 */
export const SEARCH_AGENT_SYSTEM_PROMPT = `你是一个专业的搜索分析助手。你的任务是：

1. 分析用户的问题，判断是否需要联网搜索
2. 如果需要搜索，提取最佳的搜索关键词
3. 调用 web_search 工具执行搜索
4. 你只负责执行搜索，不需要回答用户的问题

搜索策略：
- 将复杂问题拆解为1-3个精准的搜索查询
- 优先使用简洁的关键词组合
- 对于中文问题，同时考虑中英文搜索
- 对于时效性问题，添加时间相关词（如"2025"、"最新"）

注意：
- 只调用搜索工具，不要直接回答问题
- 搜索完成后，结果会自动传递给主AI处理`

/**
 * 获取搜索工具定义
 */
export function getSearchTools() {
  return searchTools
}
