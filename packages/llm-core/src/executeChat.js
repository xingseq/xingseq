/**
 * executeChat - llm-core 自身的高层对话 API
 *
 * 设计目标：
 *   - 一站式串联 client + requestBuilder + parseStream + errorHandler + sessionManager
 *   - apiKey、tools 等业务相关数据由调用方注入，不反向依赖 config-core / chatFlow
 *   - 工具调用循环、搜索代理、工具组动态加载 等高级编排留给 L2/L3 实现
 *
 * 与 develop 中 aiServiceCore.chat / chatFlow.executeChatFlow 的差异：
 *   - 不读取 configManager；apiKey 显式入参
 *   - 不动态加载工具组；tools 直接入参（一组完整 OpenAI tools 数组）
 *   - 不递归处理 tool_calls；返回首轮结果，由上层决定下一步
 */

import { createClient, refreshProxyAgent } from './clients.js'
import { buildRequestParams, addSystemPrompt } from './requestBuilder.js'
import { parseStream } from './streamParser.js'
import { parseApiError, logApiError } from './errorHandler.js'
import { createSessionController, cleanupSession } from './sessionManager.js'
import { getLogger } from '@xingseq/shared-utils/logger'

const logger = getLogger('ExecuteChat')

/**
 * 执行一次对话（单轮，不处理工具调用循环）
 *
 * @param {object}   options
 * @param {string}   options.apiKey                   - API Key（必填）
 * @param {Array}    options.messages                 - 消息历史（必填）
 * @param {string}   [options.provider='deepseek']    - 'deepseek'|'kimi'|'qwen'|'doubao'
 * @param {string}   [options.mode='chat']            - 'chat'|'reasoner'|'ep-xxx'
 * @param {string}   [options.subModel]               - 直接指定模型 ID（优先级最高）
 * @param {object}   [options.customParams]           - { temperature, stream, systemPrompt }
 * @param {Array}    [options.tools]                  - OpenAI tools 数组
 * @param {string}   [options.sessionId]              - 会话 ID（用于 abort）
 * @param {function} [options.onChunk]                - 流式数据回调 ({type,content,done})
 * @returns {Promise<{ success: boolean, fullContent?: string, reasoning_content?: string, hasReasoning?: boolean, toolCalls?: Array, fragments?: Array, model?: string, error?: object }>}
 */
export async function executeChat(options) {
  const {
    apiKey,
    messages,
    provider = 'deepseek',
    mode = 'chat',
    subModel = null,
    customParams = null,
    tools = null,
    sessionId = null,
    onChunk = null
  } = options || {}

  if (!apiKey) {
    return { success: false, error: { message: 'API Key 未提供', code: 'AUTH_FAILED', level: 'error' } }
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { success: false, error: { message: 'messages 不能为空', code: 'BAD_REQUEST', level: 'error' } }
  }

  // 刷新代理 agent（按用户配置）
  try {
    await refreshProxyAgent()
  } catch (e) {
    logger.warn('刷新代理失败（不影响主流程）:', e.message)
  }

  const client = createClient(provider, apiKey)
  const enrichedMessages = addSystemPrompt(messages, mode, customParams)
  const { requestParams, model } = buildRequestParams({
    messages: enrichedMessages,
    mode,
    customParams,
    tools,
    provider,
    subModel
  })

  const controller = sessionId ? createSessionController(sessionId) : new AbortController()

  try {
    const stream = await client.chat.completions.create(requestParams, { signal: controller.signal })

    // 非流式响应分支（customParams.stream === false）
    if (requestParams.stream === false) {
      const choice = stream.choices?.[0]
      const content = choice?.message?.content || ''
      const reasoning = choice?.message?.reasoning_content || ''
      const toolCalls = choice?.message?.tool_calls || []
      return {
        success: true,
        fullContent: content,
        reasoning_content: reasoning,
        hasReasoning: !!reasoning,
        toolCalls,
        fragments: [
          ...(reasoning ? [{ type: 'THINK', content: reasoning }] : []),
          ...(content   ? [{ type: 'RESPONSE', content }]         : [])
        ],
        model
      }
    }

    // 流式响应分支
    const result = await parseStream(stream, onChunk)
    return { success: true, ...result, model }
  } catch (error) {
    const errorInfo = parseApiError(error, provider)
    logApiError(errorInfo, error)
    return { success: false, error: errorInfo, model }
  } finally {
    if (sessionId) cleanupSession(sessionId)
  }
}
