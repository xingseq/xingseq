/**
 * chat-core 执行轨迹（trace）收集器
 *
 * 用于记录一次 chat() 调用背后的完整执行过程：
 *   - LLM 请求与响应
 *   - 工具调用意图
 *   - 工具实际执行结果 / 错误 / 拒绝
 *   - 最终回复
 *
 * 轨迹是星序图沉淀的原材料：把多次成功执行后的 trace 交给 flow-engine，
 * 即可提炼出可复用的任务流程图。
 */

export const TRACE_EVENT_TYPES = Object.freeze({
  LLM_REQUEST: 'llm-request',
  LLM_RESPONSE: 'llm-response',
  TOOL_EXECUTION: 'tool-execution',
  TOOL_DENIED: 'tool-denied',
  ERROR: 'error',
  FINAL: 'final'
})

export class TraceCollector {
  /**
   * @param {object} [opts]
   * @param {string} [opts.traceId]
   * @param {string} [opts.sessionId]
   */
  constructor(opts = {}) {
    this.traceId = opts.traceId || `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.sessionId = opts.sessionId || null
    this.startedAt = Date.now()
    this.finishedAt = null
    this.events = []
  }

  /**
   * 添加一个原始事件
   * @param {object} event
   * @param {string} event.type
   * @param {object} event.payload
   */
  add(event) {
    this.events.push({
      timestamp: Date.now(),
      type: event.type,
      payload: event.payload
    })
  }

  llmRequest(payload) {
    this.add({ type: TRACE_EVENT_TYPES.LLM_REQUEST, payload })
  }

  llmResponse(payload) {
    this.add({ type: TRACE_EVENT_TYPES.LLM_RESPONSE, payload })
  }

  toolExecution(payload) {
    this.add({ type: TRACE_EVENT_TYPES.TOOL_EXECUTION, payload })
  }

  toolDenied(payload) {
    this.add({ type: TRACE_EVENT_TYPES.TOOL_DENIED, payload })
  }

  error(payload) {
    this.add({ type: TRACE_EVENT_TYPES.ERROR, payload })
  }

  final(payload) {
    this.add({ type: TRACE_EVENT_TYPES.FINAL, payload })
  }

  /**
   * 结束收集并返回可序列化的 trace 对象
   * @returns {object}
   */
  finish() {
    this.finishedAt = Date.now()
    return this.toJSON()
  }

  toJSON() {
    return {
      traceId: this.traceId,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      events: this.events
    }
  }
}

/**
 * 工厂函数：方便调用方快速创建一个 trace collector
 * @param {object} [opts]
 * @returns {TraceCollector}
 */
export function createTraceCollector(opts) {
  return new TraceCollector(opts)
}
