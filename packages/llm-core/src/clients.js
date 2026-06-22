/**
 * AI 客户端模块 - 多 provider OpenAI 兼容客户端 + 模型映射
 *
 * 迁入自 electron/ai/aiClient.js（更名为 clients.js）
 * 改动：proxyManager import 改自 @xingseq/shared-utils/proxyManager
 */

import OpenAI from 'openai'
import pkg from 'https-proxy-agent'
const { HttpsProxyAgent } = pkg
import { getProxyUrl, getSystemProxyUrl } from '@xingseq/shared-utils/proxyManager'

// DeepSeek API 配置
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

// Kimi (Moonshot) API 配置
const KIMI_BASE_URL = 'https://api.moonshot.cn/v1'

// 通义千问 (Qwen) API 配置
const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

// 豆包 (Doubao) API 配置 - 火山方舟平台
const DOUBAO_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

// DeepSeek 模型映射（V4 系列直通，旧别名向后兼容）
export const MODEL_MAP = {
  'chat': 'deepseek-v4-flash',
  'reasoner': 'deepseek-v4-pro',
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-pro',
  'deepseek-v4-flash': 'deepseek-v4-flash',
  'deepseek-v4-pro': 'deepseek-v4-pro'
}

// Kimi 模型映射
export const KIMI_MODEL_MAP = {
  'chat': 'moonshot-v1-8k',
  'reasoner': 'kimi-k2-thinking',
  'moonshot-v1-8k': 'moonshot-v1-8k',
  'moonshot-v1-32k': 'moonshot-v1-32k',
  'moonshot-v1-128k': 'moonshot-v1-128k',
  'kimi-k2.5': 'kimi-k2.5',
  'kimi-k2-thinking': 'kimi-k2-thinking'
}

// 通义千问 模型映射
export const QWEN_MODEL_MAP = {
  'chat': 'qwen-plus',
  'reasoner': 'qwq-plus',
  'qwen-turbo': 'qwen-turbo',
  'qwen-plus': 'qwen-plus',
  'qwen-max': 'qwen-max',
  'qwen-long': 'qwen-long',
  'qwen-vl-plus': 'qwen-vl-plus',
  'qwen-vl-max': 'qwen-vl-max',
  'qwq-plus': 'qwq-plus'
}

// 豆包 模型映射（火山方舟平台）
export const DOUBAO_MODEL_MAP = {
  'chat': 'doubao-1.5-pro-32k',
  'reasoner': 'doubao-1.5-pro-256k',
  'doubao-1.5-pro-256k': 'doubao-1.5-pro-256k',
  'doubao-1.5-pro-32k': 'doubao-1.5-pro-32k',
  'doubao-1.5-lite-32k': 'doubao-1.5-lite-32k',
  'doubao-pro-4k': 'doubao-pro-4k',
  'doubao-pro-32k': 'doubao-pro-32k',
  'doubao-pro-128k': 'doubao-pro-128k',
  'doubao-lite-4k': 'doubao-lite-4k',
  'doubao-lite-32k': 'doubao-lite-32k',
  'doubao-lite-128k': 'doubao-lite-128k',
  'doubao-seed-code': 'doubao-seed-code'
}

// 缓存代理 agent
let _httpAgent = null
let _lastProxyUrl = null

/**
 * 获取代理 Agent（同步版本，供 SDK 初始化使用）
 * 实际代理控制由配置决定，调用前需先用 refreshProxyAgent 更新
 * @returns {HttpsProxyAgent|null}
 */
function getHttpAgent() {
  const proxyUrl = getSystemProxyUrl()

  if (proxyUrl !== _lastProxyUrl) {
    _lastProxyUrl = proxyUrl
    if (proxyUrl) {
      _httpAgent = new HttpsProxyAgent(proxyUrl)
    } else {
      _httpAgent = null
    }
  }

  return _httpAgent
}

/**
 * 刷新代理 Agent（根据用户配置）
 * 在发起请求前调用
 * @returns {Promise<void>}
 */
export async function refreshProxyAgent() {
  const proxyUrl = await getProxyUrl()

  if (proxyUrl !== _lastProxyUrl) {
    _lastProxyUrl = proxyUrl
    if (proxyUrl) {
      _httpAgent = new HttpsProxyAgent(proxyUrl)
    } else {
      _httpAgent = null
    }
  }
}

function makeOptions(apiKey, baseURL) {
  const httpAgent = getHttpAgent()
  const options = { apiKey, baseURL }
  if (httpAgent) options.httpAgent = httpAgent
  return options
}

/**
 * 创建 DeepSeek 客户端
 */
export function createDeepSeekClient(apiKey) {
  return new OpenAI(makeOptions(apiKey, DEEPSEEK_BASE_URL))
}

/**
 * 创建 Kimi (Moonshot) 客户端
 */
export function createKimiClient(apiKey) {
  return new OpenAI(makeOptions(apiKey, KIMI_BASE_URL))
}

/**
 * 创建通义千问 (Qwen) 客户端
 */
export function createQwenClient(apiKey) {
  return new OpenAI(makeOptions(apiKey, QWEN_BASE_URL))
}

/**
 * 创建豆包 (Doubao) 客户端
 */
export function createDoubaoClient(apiKey) {
  return new OpenAI(makeOptions(apiKey, DOUBAO_BASE_URL))
}

/**
 * 按 provider 创建客户端
 * @param {string} provider - 'deepseek'|'kimi'|'qwen'|'doubao'
 * @param {string} apiKey
 * @returns {OpenAI}
 */
export function createClient(provider, apiKey) {
  switch (provider) {
    case 'kimi': return createKimiClient(apiKey)
    case 'qwen': return createQwenClient(apiKey)
    case 'doubao': return createDoubaoClient(apiKey)
    case 'deepseek':
    default: return createDeepSeekClient(apiKey)
  }
}

/**
 * 获取可用的 DeepSeek 模型列表
 */
export function getAvailableModels() {
  return [
    { id: 'chat',     name: '普通聊天', description: 'DeepSeek V4 Flash - 适用于日常对话，1M 上下文', model: MODEL_MAP.chat },
    { id: 'reasoner', name: '深度思考', description: 'DeepSeek V4 Pro - 旗舰推理模型，1M 上下文，默认思考模式', model: MODEL_MAP.reasoner }
  ]
}

/**
 * 获取可用的 Kimi 模型列表
 */
export function getAvailableKimiModels() {
  return [
    { id: 'moonshot-v1-8k',   name: 'Moonshot V1 8K',        description: 'Kimi 标准模型 - 8K 上下文窗口',          model: KIMI_MODEL_MAP['moonshot-v1-8k'] },
    { id: 'moonshot-v1-32k',  name: 'Moonshot V1 32K',       description: 'Kimi 长文本模型 - 32K 上下文窗口',        model: KIMI_MODEL_MAP['moonshot-v1-32k'] },
    { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K',      description: 'Kimi 超长文本模型 - 128K 上下文窗口',      model: KIMI_MODEL_MAP['moonshot-v1-128k'] },
    { id: 'kimi-k2.5',        name: 'Kimi K2.5 (全能)',       description: 'Kimi 最新全能模型 - 262K 上下文',          model: KIMI_MODEL_MAP['kimi-k2.5'] },
    { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking (深度思考)', description: 'Kimi 专用思考模型 - 262K 上下文',  model: KIMI_MODEL_MAP['kimi-k2-thinking'] }
  ]
}

/**
 * 获取可用的通义千问模型列表
 */
export function getAvailableQwenModels() {
  return [
    { id: 'qwen-turbo', name: 'Qwen Turbo', description: '通义千问超高速版 - 速度优先',          model: QWEN_MODEL_MAP['qwen-turbo'] },
    { id: 'qwen-plus',  name: 'Qwen Plus',  description: '通义千问增强版 - 效果与速度平衡（推荐）', model: QWEN_MODEL_MAP['qwen-plus'] },
    { id: 'qwen-max',   name: 'Qwen Max',   description: '通义千问旗舰版 - 复杂任务首选',         model: QWEN_MODEL_MAP['qwen-max'] },
    { id: 'qwen-long',  name: 'Qwen Long',  description: '通义千问长文本版 - 超长上下文支持',      model: QWEN_MODEL_MAP['qwen-long'] },
    { id: 'qwq-plus',   name: 'QwQ Plus (推理)', description: '通义千问深度推理模型',             model: QWEN_MODEL_MAP['qwq-plus'] }
  ]
}

/**
 * 获取可用的豆包模型列表
 */
export function getAvailableDoubaoModels() {
  return [
    { id: 'doubao-1.5-pro-32k',  name: 'Doubao 1.5 Pro 32K',  description: '豆包 1.5 Pro 性价比版（推荐）',   model: DOUBAO_MODEL_MAP['doubao-1.5-pro-32k'] },
    { id: 'doubao-1.5-pro-256k', name: 'Doubao 1.5 Pro 256K', description: '豆包 1.5 Pro 旗舰版 - 256K 超长上下文', model: DOUBAO_MODEL_MAP['doubao-1.5-pro-256k'] },
    { id: 'doubao-1.5-lite-32k', name: 'Doubao 1.5 Lite 32K', description: '豆包 1.5 Lite 轻量版',           model: DOUBAO_MODEL_MAP['doubao-1.5-lite-32k'] },
    { id: 'doubao-pro-128k',     name: 'Doubao Pro 128K',     description: '豆包 Pro 通用版 - 128K 长上下文', model: DOUBAO_MODEL_MAP['doubao-pro-128k'] },
    { id: 'doubao-lite-32k',     name: 'Doubao Lite 32K',     description: '豆包 Lite 轻量版',               model: DOUBAO_MODEL_MAP['doubao-lite-32k'] }
  ]
}
