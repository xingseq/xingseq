/**
 * AI Provider 常量 - 统一管理各服务商显示名称
 */

/**
 * Provider 显示名称映射
 */
export const PROVIDER_DISPLAY_NAMES = Object.freeze({
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  qwen: '通义千问',
  doubao: '豆包',
  openai: 'OpenAI',
  anthropic: 'Anthropic'
})

/**
 * 获取 provider 的展示名称；未知 provider 原样返回。
 */
export function getProviderDisplayName(provider) {
  if (!provider) return ''
  return PROVIDER_DISPLAY_NAMES[provider] || provider
}
