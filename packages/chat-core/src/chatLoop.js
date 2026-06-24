/**
 * chatLoop - 多轮 + tool_calls 循环执行器
 *
 * 简化版的 develop chatFlow：
 *   - 不做递归安全检查的复杂分支（仅最大深度 + 简单循环检测）
 *   - 不做 fallback、searchAgent、动态工具组加载
 *   - 仅串联 executeChat → registry.dispatch → 把 tool_results 拼回 messages → 再调
 *
 * 入参 messages 会被原地 mutate（push assistant / tool 消息），对齐 OpenAI 协议。
 */

import { executeChat } from '@xingseq/llm-core'

const DEFAULT_MAX_DEPTH = 5

/**
 * @param {object} opts
 * @param {string}   opts.apiKey
 * @param {Array}    opts.messages           - 会话消息（会被 mutate）
 * @param {Array}    [opts.tools]            - OpenAI tools 数组
 * @param {object}   [opts.registry]         - tool-registry 实例（提供 dispatch）
 * @param {string}   [opts.provider]
 * @param {string}   [opts.mode]
 * @param {string}   [opts.subModel]
 * @param {object}   [opts.customParams]
 * @param {string}   [opts.sessionId]
 * @param {function} [opts.onChunk]
 * @param {function} [opts.onToolCall]       - 工具开始执行时回调 (toolCall) => void
 * @param {function} [opts.onToolResult]     - 工具执行完成回调 (toolCall, result, error?) => void
 * @param {function} [opts.onToolDenied]     - 工具被拒绝时回调 (toolCall) => void
 * @param {object}   [opts.confirmation]     - 工具确认管理器（createConfirmationManager 返回值）
 * @param {number}   [opts.maxDepth=5]
 * @param {function} [opts.executor]         - 注入式 chat 执行器（默认 executeChat）；测试用
 * @returns {Promise<{ success, fullContent?, toolCalls?, depth, error?, model? }>}
 */
export async function runChatTurnWithTools(opts) {
  const {
    apiKey,
    messages,
    tools = null,
    registry = null,
    provider = 'deepseek',
    mode = 'chat',
    subModel = null,
    customParams = null,
    sessionId = null,
    onChunk = null,
    onToolCall = null,
    onToolResult = null,
    onToolDenied = null,
    confirmation = null,
    maxDepth = DEFAULT_MAX_DEPTH,
    executor = executeChat
  } = opts || {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return { success: false, error: { message: 'messages 不能为空', code: 'BAD_REQUEST' }, depth: 0 }
  }

  for (let depth = 0; depth < maxDepth; depth++) {
    const result = await executor({
      apiKey,
      messages,
      provider,
      mode,
      subModel,
      customParams,
      tools,
      sessionId,
      onChunk
    })

    if (!result || !result.success) {
      return { ...(result || {}), depth }
    }

    const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls.filter(Boolean) : []

    // 没有工具调用：本轮就是最终回复
    if (toolCalls.length === 0) {
      messages.push({
        role: 'assistant',
        content: result.fullContent || ''
      })
      return { ...result, depth }
    }

    // 有工具调用：先把 assistant + tool_calls 入栈
    messages.push({
      role: 'assistant',
      content: result.fullContent || null,
      tool_calls: toolCalls
    })

    if (!registry || typeof registry.dispatch !== 'function') {
      // 没有 registry：直接把每个调用回成失败提示
      for (const tc of toolCalls) {
        const errMsg = JSON.stringify({ error: 'tool registry 未注入，无法执行工具' })
        messages.push({ role: 'tool', tool_call_id: tc.id, content: errMsg })
      }
      continue
    }

    // 依次派发工具
    for (const tc of toolCalls) {
      const toolName = tc.function?.name || tc.name
      // 解析参数（需要传给确认弹窗展示）
      let parsedArgs = {}
      try {
        parsedArgs = typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments || '{}')
          : (tc.function?.arguments || tc.args || tc.arguments || {})
      } catch { /* 保留空对象 */ }

      // 敏感工具需确认
      if (confirmation && typeof confirmation.confirmToolExecution === 'function') {
        const ok = await confirmation.confirmToolExecution(toolName, parsedArgs).catch(() => false)
        if (!ok) {
          if (onToolDenied) onToolDenied(tc)
          const denyMsg = JSON.stringify({ error: '用户拒绝了本次工具调用', tool: toolName })
          messages.push({ role: 'tool', tool_call_id: tc.id, content: denyMsg })
          continue
        }
      }

      if (onToolCall) onToolCall(tc)
      let toolPayload
      try {
        const toolResult = await registry.dispatch(tc, { sessionId })
        toolPayload = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
        if (onToolResult) onToolResult(tc, toolResult, null)
      } catch (err) {
        toolPayload = JSON.stringify({ error: err.message || String(err) })
        if (onToolResult) onToolResult(tc, null, err)
      }
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: toolPayload
      })
    }
    // 进入下一轮
  }

  return {
    success: false,
    error: { message: `达到最大工具调用深度 ${maxDepth}`, code: 'MAX_DEPTH' },
    depth: maxDepth
  }
}
