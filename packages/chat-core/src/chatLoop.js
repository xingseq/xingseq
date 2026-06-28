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
import { TraceCollector } from './trace.js'

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
 * @param {import('./trace.js').TraceCollector} [opts.trace] - 执行轨迹收集器（可选）
 * @returns {Promise<{ success, fullContent?, toolCalls?, depth, error?, model?, trace? }>}
 */
export async function runChatTurnWithTools(opts) {
  const trace = opts?.trace || new TraceCollector({ sessionId: opts?.sessionId || null })

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
    trace.error({ message: 'messages 不能为空', code: 'BAD_REQUEST' })
    return { success: false, error: { message: 'messages 不能为空', code: 'BAD_REQUEST' }, depth: 0, trace: trace.finish() }
  }

  for (let depth = 0; depth < maxDepth; depth++) {
    trace.llmRequest({
      depth,
      messageCount: messages.length,
      lastMessage: messages[messages.length - 1],
      tools: tools ? tools.map(t => t.function?.name || t.name).filter(Boolean) : null,
      provider,
      mode,
      subModel,
      customParams
    })

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
      trace.error({ depth, error: result?.error || 'LLM 调用失败' })
      return { ...(result || {}), depth, trace: trace.finish() }
    }

    const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls.filter(Boolean) : []

    trace.llmResponse({
      depth,
      content: result.fullContent,
      toolCalls,
      usage: result.usage,
      model: result.model,
      finishReason: result.finishReason
    })

    // 没有工具调用：本轮就是最终回复
    if (toolCalls.length === 0) {
      messages.push({
        role: 'assistant',
        content: result.fullContent || ''
      })
      trace.final({ content: result.fullContent, depth })
      return { ...result, depth, trace: trace.finish() }
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
        trace.toolExecution({ toolCall: tc, result: null, error: 'tool registry 未注入，无法执行工具' })
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
          trace.toolDenied({ toolCall: tc, reason: '用户拒绝' })
          const denyMsg = JSON.stringify({ error: '用户拒绝了本次工具调用', tool: toolName })
          messages.push({ role: 'tool', tool_call_id: tc.id, content: denyMsg })
          continue
        }
      }

      if (onToolCall) onToolCall(tc)
      const toolStart = Date.now()
      let toolPayload
      let toolError = null
      let toolResult = null
      try {
        toolResult = await registry.dispatch(tc, { sessionId })
        toolPayload = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
        if (onToolResult) onToolResult(tc, toolResult, null)
      } catch (err) {
        toolError = err.message || String(err)
        toolPayload = JSON.stringify({ error: toolError })
        if (onToolResult) onToolResult(tc, null, err)
      }
      trace.toolExecution({
        toolCall: tc,
        result: toolResult,
        error: toolError,
        duration: Date.now() - toolStart
      })
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: toolPayload
      })
    }
    // 进入下一轮
  }

  const maxDepthError = { message: `达到最大工具调用深度 ${maxDepth}`, code: 'MAX_DEPTH' }
  trace.error({ depth: maxDepth, error: maxDepthError })
  return {
    success: false,
    error: maxDepthError,
    depth: maxDepth,
    trace: trace.finish()
  }
}
