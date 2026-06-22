/**
 * 请求构建模块 - 构建 AI 请求参数（OpenAI 兼容协议）
 *
 * 迁入自 electron/ai/requestBuilder.js
 * 改动：
 *   - logger import 改自 @xingseq/shared-utils/logger
 *   - 去除对 ../tools/toolDefinitions.js 的依赖；tools 改由调用方以数组形式传入
 *     原 develop 中 enableTools='overview' / 已加载工具组动态构建 的逻辑由 L2/L3 编排层负责
 */

import { getLogger } from '@xingseq/shared-utils/logger'
import { MODEL_MAP } from './clients.js'

const logger = getLogger('RequestBuilder')

/**
 * 构建请求参数
 * @param {object} options
 * @param {Array}   options.messages       - 消息历史
 * @param {string}  options.mode           - 'chat' | 'reasoner' | 'ep-xxx'（doubao 端点）
 * @param {object}  options.customParams   - 自定义参数 { temperature, stream, systemPrompt, subModel }
 * @param {Array}   options.tools          - 工具数组（OpenAI tools schema），不传则不启用工具
 * @param {string}  options.provider       - 'deepseek' | 'kimi' | 'qwen' | 'doubao' | 'openai'
 * @param {string}  options.subModel       - 直接指定的子模型 ID
 * @returns {{ requestParams: object, model: string }}
 */
export function buildRequestParams({
  messages,
  mode,
  customParams,
  tools = null,
  provider = 'deepseek',
  subModel = null
}) {
  // ===== 选模型 =====
  let model

  if (subModel) {
    model = subModel
    logger.info(`使用指定的子模型: ${model}`)
  } else {
    switch (provider) {
      case 'kimi':
        if (mode === 'reasoner') {
          model = 'kimi-k2-thinking'
          logger.info('使用 Kimi K2 深度思考模型')
        } else {
          model = 'moonshot-v1-32k'
        }
        break
      case 'qwen':
        if (mode === 'reasoner') {
          model = 'qwq-plus'
          logger.info('使用 通义千问 QwQ 深度推理模型')
        } else {
          model = 'qwen-plus'
        }
        break
      case 'doubao':
        if (mode && mode.startsWith('ep-')) {
          model = mode
          logger.info(`使用 豆包端点: ${mode}`)
        } else if (mode === 'reasoner') {
          model = 'doubao-1.5-pro-256k'
          logger.info('使用 豆包 1.5 Pro 256K 旗舰模型')
        } else {
          model = 'doubao-1.5-pro-32k'
        }
        break
      case 'openai':
        model = mode === 'reasoner' ? 'gpt-4o' : 'gpt-4o-mini'
        break
      case 'deepseek':
      default:
        model = MODEL_MAP[mode] || MODEL_MAP['chat']
        break
    }
  }

  // ===== 基础参数 =====
  // Kimi 思考模型（kimi-k2-thinking / kimi-k2.5）要求 max_tokens >= 16000
  const isKimiThinkingModel = provider === 'kimi' &&
    (model === 'kimi-k2-thinking' || model === 'kimi-k2.5')
  const defaultMaxTokens = isKimiThinkingModel ? 32768 : 8000

  const requestParams = {
    model,
    messages,
    stream: customParams ? (customParams.stream ?? true) : true,
    temperature: customParams ? (customParams.temperature ?? 1.0) : 1.0,
    max_tokens: defaultMaxTokens
  }

  // ===== 工具参数 =====
  // 注意：豆包端点 (ep-xxx) 部分模型不支持 tool_choice 参数
  const isDoubaoEndpoint = provider === 'doubao' && model && model.startsWith('ep-')
  if (Array.isArray(tools) && tools.length > 0) {
    requestParams.tools = tools
    if (!isDoubaoEndpoint) {
      requestParams.tool_choice = 'auto'
    }
    logger.debug(`[工具] 启用 ${tools.length} 个工具`)
  }

  return { requestParams, model }
}

/**
 * 添加系统提示词到消息列表
 * @param {Array} messages
 * @param {string} _mode - 保留入参以兼容原签名
 * @param {object} customParams
 * @returns {Array}
 */
export function addSystemPrompt(messages, _mode, customParams) {
  if (customParams && customParams.systemPrompt) {
    const systemMessage = {
      role: 'system',
      content: customParams.systemPrompt
    }
    return [systemMessage, ...messages]
  }
  return messages
}
