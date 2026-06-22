/**
 * @xingseq/llm-core
 *
 * L1 基座：多 provider LLM 客户端、请求构建、流式解析、错误标准化、会话控制
 *
 * 推荐使用子路径 import：
 *   import { createDeepSeekClient } from '@xingseq/llm-core/clients'
 *   import { parseStream }          from '@xingseq/llm-core/streamParser'
 *   import { executeChat }          from '@xingseq/llm-core/executeChat'
 *   import { parseApiError }        from '@xingseq/llm-core/errorHandler'
 *
 * 默认 barrel 也聚合导出全部 API：
 *   import { executeChat, parseStream, createClient } from '@xingseq/llm-core'
 */

// clients
export {
  createDeepSeekClient,
  createKimiClient,
  createQwenClient,
  createDoubaoClient,
  createClient,
  refreshProxyAgent,
  getAvailableModels,
  getAvailableKimiModels,
  getAvailableQwenModels,
  getAvailableDoubaoModels,
  MODEL_MAP,
  KIMI_MODEL_MAP,
  QWEN_MODEL_MAP,
  DOUBAO_MODEL_MAP
} from './clients.js'

// requestBuilder
export { buildRequestParams, addSystemPrompt } from './requestBuilder.js'

// streamParser
export { parseStream } from './streamParser.js'

// errorHandler
export { parseApiError, logApiError, isRetryableWithFallback } from './errorHandler.js'

// sessionManager
export { createSessionController, abortSession, cleanupSession } from './sessionManager.js'

// executeChat (高层 API)
export { executeChat } from './executeChat.js'
