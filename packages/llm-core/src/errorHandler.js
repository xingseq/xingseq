/**
 * AI API 错误处理模块 - 统一处理各种 AI 服务的错误并返回用户友好的提示
 *
 * 迁入自 electron/ai/errorHandler.js
 * 改动：
 *   - logger import 改自 @xingseq/shared-utils/logger
 *   - getProviderDisplayName import 改自 @xingseq/shared-utils/constants/provider
 */

import { getLogger } from '@xingseq/shared-utils/logger'
import { getProviderDisplayName } from '@xingseq/shared-utils/constants/provider'

const logger = getLogger('ErrorHandler')

/**
 * 解析 API 错误并返回用户友好的错误信息
 * @param {Error} error
 * @param {string} provider
 * @returns {{ message: string, logMessage: string, code: string, level: string }}
 */
export function parseApiError(error, provider = 'deepseek') {
  if (error.name === 'AbortError') {
    return {
      message: '已终止',
      logMessage: 'AI回复已被用户终止',
      code: 'ABORTED',
      level: 'info'
    }
  }

  const normalizedProvider = provider || 'deepseek'
  const parser = ERROR_PARSERS[normalizedProvider] || ERROR_PARSERS.default
  const result = parser(error)

  // 兜底：402 HTTP 状态码 → 余额不足
  if (result.code === 'UNKNOWN_ERROR' && error.status === 402) {
    const displayName = getProviderDisplayName(normalizedProvider)
    return {
      message: `${displayName} API 余额不足，请充值后继续使用`,
      logMessage: `${displayName} API余额不足 (HTTP 402)`,
      code: 'INSUFFICIENT_BALANCE',
      level: 'error'
    }
  }

  return result
}

function parseDeepSeekError(error) {
  const status = error.status
  const message = error.message || ''

  if (status === 402 || message.includes('402') || message.includes('Insufficient Balance')) {
    return {
      message: 'DeepSeek API 余额不足，请前往 https://platform.deepseek.com 充值后继续使用\n注意：充值后可能需要等待几分钟才能生效',
      logMessage: 'DeepSeek API余额不足',
      code: 'INSUFFICIENT_BALANCE',
      level: 'error'
    }
  }
  if (status === 401 || message.includes('401') || message.includes('Unauthorized')) {
    return { message: 'DeepSeek API Key 无效或已过期，请在设置中检查并更新', logMessage: 'DeepSeek API认证失败', code: 'AUTH_FAILED', level: 'error' }
  }
  if (status === 429 || message.includes('429') || message.includes('Rate Limit')) {
    return { message: 'DeepSeek API 请求过于频繁，请稍后再试', logMessage: 'DeepSeek API速率限制', code: 'RATE_LIMIT', level: 'error' }
  }
  if (
    (status === 400 || message.includes('400')) &&
    (message.includes('context') || message.includes('token') || message.includes('length') ||
     message.includes('maximum') || message.includes('exceeds') || message.includes('limit'))
  ) {
    return { message: 'Token 数量超过限制，请尝试：\n1. 开启新的对话\n2. 减少消息长度\n3. 删除部分历史消息', logMessage: 'DeepSeek API Token限制超限', code: 'TOKEN_LIMIT_EXCEEDED', level: 'error' }
  }
  if (status >= 500 && status < 600) {
    return { message: 'DeepSeek 服务暂时不可用，请稍后重试', logMessage: `DeepSeek 服务器错误: ${status}`, code: 'SERVER_ERROR', level: 'error' }
  }
  if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT') || message.includes('network')) {
    return { message: '网络连接失败，请检查网络设置后重试', logMessage: `网络错误: ${message}`, code: 'NETWORK_ERROR', level: 'error' }
  }
  return { message: `DeepSeek API 调用失败: ${message}`, logMessage: `DeepSeek API调用失败: ${message}`, code: 'UNKNOWN_ERROR', level: 'error' }
}

function parseOpenAIError(error) {
  const status = error.status
  const message = error.message || ''
  const errorType = error.error?.type || error.type

  if (status === 401 || status === 403 || message.includes('invalid_api_key') || message.includes('access')) {
    return { message: 'OpenAI API Key 无效或权限不足，请在设置中检查并更新', logMessage: 'OpenAI API认证失败', code: 'AUTH_FAILED', level: 'error' }
  }
  if (status === 402 || message.includes('insufficient_quota') || message.includes('billing')) {
    return { message: 'OpenAI API 余额不足，请检查账户计费状态后继续使用\n注意：充值后可能需要等待几分钟才能生效', logMessage: 'OpenAI API余额不足', code: 'INSUFFICIENT_BALANCE', level: 'error' }
  }
  if (status === 429 || message.includes('rate_limit') || message.includes('Too many requests')) {
    return { message: 'OpenAI API 请求过于频繁，请稍后再试', logMessage: 'OpenAI API速率限制', code: 'RATE_LIMIT', level: 'error' }
  }
  if (status === 400 && (message.includes('context_length') || message.includes('tokens') || message.includes('maximum') || message.includes('exceeded'))) {
    return { message: 'Token 数量超过限制，请尝试：\n1. 开启新的对话\n2. 减少消息长度\n3. 删除部分历史消息', logMessage: 'OpenAI API Token限制超限', code: 'TOKEN_LIMIT_EXCEEDED', level: 'error' }
  }
  if (status === 500 || status === 503 || errorType === 'server_error') {
    return { message: 'OpenAI 服务暂时不可用，请稍后重试', logMessage: `OpenAI 服务器错误: ${status}`, code: 'SERVER_ERROR', level: 'error' }
  }
  if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT') || message.includes('network')) {
    return { message: '网络连接失败，请检查网络设置后重试', logMessage: `网络错误: ${message}`, code: 'NETWORK_ERROR', level: 'error' }
  }
  return { message: `OpenAI API 调用失败: ${message}`, logMessage: `OpenAI API调用失败: ${message}`, code: 'UNKNOWN_ERROR', level: 'error' }
}

function parseAnthropicError(error) {
  const status = error.status
  const message = error.message || ''

  if (status === 401 || message.includes('invalid_auth') || message.includes('authentication')) {
    return { message: 'Anthropic API Key 无效或已过期，请在设置中检查并更新', logMessage: 'Anthropic API认证失败', code: 'AUTH_FAILED', level: 'error' }
  }
  if (status === 403 || status === 429 || message.includes('insufficient_funds') || message.includes('quota')) {
    return { message: 'Anthropic API 配额已用完，请升级账户后继续使用\n注意：充值后可能需要等待几分钟才能生效', logMessage: 'Anthropic API配额不足', code: 'INSUFFICIENT_BALANCE', level: 'error' }
  }
  if (message.includes('rate_limit') || message.includes('Too many requests')) {
    return { message: 'Anthropic API 请求过于频繁，请稍后再试', logMessage: 'Anthropic API速率限制', code: 'RATE_LIMIT', level: 'error' }
  }
  if (status === 400 && (message.includes('prompt') || message.includes('token') || message.includes('context') || message.includes('maximum') || message.includes('exceeds'))) {
    return { message: 'Token 数量超过限制，请尝试：\n1. 开启新的对话\n2. 减少消息长度\n3. 删除部分历史消息', logMessage: 'Anthropic API Token限制超限', code: 'TOKEN_LIMIT_EXCEEDED', level: 'error' }
  }
  if (status >= 500 && status < 600) {
    return { message: 'Anthropic 服务暂时不可用，请稍后重试', logMessage: `Anthropic 服务器错误: ${status}`, code: 'SERVER_ERROR', level: 'error' }
  }
  if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT') || message.includes('network')) {
    return { message: '网络连接失败，请检查网络设置后重试', logMessage: `网络错误: ${message}`, code: 'NETWORK_ERROR', level: 'error' }
  }
  return { message: `Anthropic API 调用失败: ${message}`, logMessage: `Anthropic API调用失败: ${message}`, code: 'UNKNOWN_ERROR', level: 'error' }
}

function parseKimiError(error) {
  const status = error.status
  const message = error.message || ''

  if (status === 401 || message.includes('invalid_api_key') || message.includes('Unauthorized')) {
    return { message: 'Kimi API Key 无效或已过期，请在设置中检查并更新\n获取 API Key: https://platform.moonshot.cn', logMessage: 'Kimi API认证失败', code: 'AUTH_FAILED', level: 'error' }
  }
  if (status === 402 || message.includes('insufficient_quota') || message.includes('billing')) {
    return { message: 'Kimi API 余额不足，请前往 https://platform.moonshot.cn 充值后继续使用', logMessage: 'Kimi API余额不足', code: 'INSUFFICIENT_BALANCE', level: 'error' }
  }
  if (status === 429 || message.includes('rate_limit') || message.includes('Too many requests')) {
    return { message: 'Kimi API 请求过于频繁，请稍后再试', logMessage: 'Kimi API速率限制', code: 'RATE_LIMIT', level: 'error' }
  }
  if (status === 400 && (message.includes('context_length') || message.includes('token') || message.includes('maximum') || message.includes('exceeded'))) {
    return { message: 'Token 数量超过限制，请尝试：\n1. 开启新的对话\n2. 减少消息长度\n3. 使用更大上下文窗口的模型 (32k/128k)', logMessage: 'Kimi API Token限制超限', code: 'TOKEN_LIMIT_EXCEEDED', level: 'error' }
  }
  if (status >= 500 && status < 600) {
    return { message: 'Kimi 服务暂时不可用，请稍后重试', logMessage: `Kimi 服务器错误: ${status}`, code: 'SERVER_ERROR', level: 'error' }
  }
  if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT') || message.includes('network')) {
    return { message: '网络连接失败，请检查网络设置后重试', logMessage: `网络错误: ${message}`, code: 'NETWORK_ERROR', level: 'error' }
  }
  return { message: `Kimi API 调用失败: ${message}`, logMessage: `Kimi API调用失败: ${message}`, code: 'UNKNOWN_ERROR', level: 'error' }
}

function parseQwenError(error) {
  const status = error.status
  const message = error.message || ''
  const errorCode = error.error?.code || error.code

  if (status === 401 || message.includes('InvalidApiKey') || message.includes('Unauthorized') || errorCode === 'InvalidApiKey') {
    return { message: '通义千问 API Key 无效或已过期，请在设置中检查并更新\n获取 API Key: https://dashscope.console.aliyun.com', logMessage: '通义千问 API认证失败', code: 'AUTH_FAILED', level: 'error' }
  }
  if (status === 402 || status === 403 || message.includes('Arrearage') || message.includes('quota') || errorCode === 'Arrearage') {
    return { message: '通义千问 API 余额不足或配额已用完，请前往阿里云控制台充值\n充值地址: https://dashscope.console.aliyun.com', logMessage: '通义千问 API余额不足', code: 'INSUFFICIENT_BALANCE', level: 'error' }
  }
  if (status === 429 || message.includes('rate_limit') || message.includes('Too many requests') || message.includes('RateLimitReached')) {
    return { message: '通义千问 API 请求过于频繁，请稍后再试', logMessage: '通义千问 API速率限制', code: 'RATE_LIMIT', level: 'error' }
  }
  if (status === 400 && (message.includes('context_length') || message.includes('token') || message.includes('maximum') || message.includes('exceeded') || message.includes('DataInspectionFailed'))) {
    return { message: 'Token 数量超过限制，请尝试：\n1. 开启新的对话\n2. 减少消息长度\n3. 使用 qwen-long 模型支持更长上下文', logMessage: '通义千问 API Token限制超限', code: 'TOKEN_LIMIT_EXCEEDED', level: 'error' }
  }
  if (message.includes('ModelNotFound') || message.includes('model not found') || errorCode === 'ModelNotFound') {
    return { message: '指定的通义千问模型不存在或未开通，请检查模型名称或在控制台开通相关模型', logMessage: '通义千问模型不存在', code: 'MODEL_NOT_FOUND', level: 'error' }
  }
  if (status >= 500 && status < 600) {
    return { message: '通义千问服务暂时不可用，请稍后重试', logMessage: `通义千问服务器错误: ${status}`, code: 'SERVER_ERROR', level: 'error' }
  }
  if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT') || message.includes('network')) {
    return { message: '网络连接失败，请检查网络设置后重试', logMessage: `网络错误: ${message}`, code: 'NETWORK_ERROR', level: 'error' }
  }
  return { message: `通义千问 API 调用失败: ${message}`, logMessage: `通义千问 API调用失败: ${message}`, code: 'UNKNOWN_ERROR', level: 'error' }
}

function parseDoubaoError(error) {
  const status = error.status
  const message = error.message || ''
  const errorCode = error.error?.code || error.code

  if (status === 401 || message.includes('InvalidApiKey') || message.includes('Unauthorized') || message.includes('authentication')) {
    return { message: '豆包 API Key 无效或已过期，请在设置中检查并更新\n获取 API Key: https://console.volcengine.com/ark', logMessage: '豆包 API认证失败', code: 'AUTH_FAILED', level: 'error' }
  }
  if (status === 402 || status === 403 || message.includes('Arrearage') || message.includes('quota') || message.includes('balance')) {
    return { message: '豆包 API 余额不足或配额已用完，请前往火山引擎控制台充值\n充值地址: https://console.volcengine.com/ark', logMessage: '豆包 API余额不足', code: 'INSUFFICIENT_BALANCE', level: 'error' }
  }
  if (status === 429 || message.includes('rate_limit') || message.includes('Too many requests') || message.includes('RateLimitReached')) {
    return { message: '豆包 API 请求过于频繁，请稍后再试', logMessage: '豆包 API速率限制', code: 'RATE_LIMIT', level: 'error' }
  }
  if (status === 400 && (message.includes('context_length') || message.includes('token') || message.includes('maximum') || message.includes('exceeded') || message.includes('length'))) {
    return { message: 'Token 数量超过限制，请尝试：\n1. 开启新的对话\n2. 减少消息长度\n3. 使用 doubao-1.5-pro-256k 模型支持更长上下文', logMessage: '豆包 API Token限制超限', code: 'TOKEN_LIMIT_EXCEEDED', level: 'error' }
  }
  if (message.includes('ModelNotFound') || message.includes('model not found') || message.includes('endpoint') || errorCode === 'ModelNotFound') {
    return { message: '指定的豆包模型不存在或接入点未配置，请检查模型名称或在火山方舟控制台创建接入点', logMessage: '豆包模型不存在', code: 'MODEL_NOT_FOUND', level: 'error' }
  }
  if (status >= 500 && status < 600) {
    return { message: '豆包服务暂时不可用，请稍后重试', logMessage: `豆包服务器错误: ${status}`, code: 'SERVER_ERROR', level: 'error' }
  }
  if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT') || message.includes('network')) {
    return { message: '网络连接失败，请检查网络设置后重试', logMessage: `网络错误: ${message}`, code: 'NETWORK_ERROR', level: 'error' }
  }
  return { message: `豆包 API 调用失败: ${message}`, logMessage: `豆包 API调用失败: ${message}`, code: 'UNKNOWN_ERROR', level: 'error' }
}

/**
 * 判断错误是否可以通过切换到备用模型来恢复
 */
export function isRetryableWithFallback(error, provider) {
  if (error.name === 'AbortError') return false
  const errorInfo = parseApiError(error, provider)
  const nonRetryableCodes = ['ABORTED', 'AUTH_FAILED', 'INSUFFICIENT_BALANCE']
  return !nonRetryableCodes.includes(errorInfo.code)
}

function parseDefaultError(error) {
  const message = error.message || '未知错误'
  return {
    message: `API 调用失败: ${message}`,
    logMessage: `API调用失败: ${message}`,
    code: 'UNKNOWN_ERROR',
    level: 'error'
  }
}

const ERROR_PARSERS = {
  deepseek: parseDeepSeekError,
  openai: parseOpenAIError,
  anthropic: parseAnthropicError,
  kimi: parseKimiError,
  moonshot: parseKimiError,
  qwen: parseQwenError,
  dashscope: parseQwenError,
  doubao: parseDoubaoError,
  ark: parseDoubaoError,
  default: parseDefaultError
}

/**
 * 记录错误日志
 */
export function logApiError(errorInfo, originalError = null) {
  const logMethod = errorInfo.level === 'info' ? 'info' : 'error'
  if (originalError && errorInfo.level === 'error') {
    logger[logMethod](errorInfo.logMessage, originalError)
  } else {
    logger[logMethod](errorInfo.logMessage)
  }
}
