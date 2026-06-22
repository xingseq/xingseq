/**
 * 统一代理管理 - 全局 HTTPS_PROXY 配置统一入口
 *
 * 注：原版直接 import '../data/configManager.js'，分包后改由 env.js 注入
 * proxyEnabledReader。见 env.js。
 */
import { getSharedEnv } from './env.js'
import { getLogger } from './logger.js'

const logger = getLogger('ProxyManager')

let _cachedUseProxy = null
let _cacheTime = 0
const CACHE_TTL = 5000

/**
 * 获取代理开关（带 5s 缓存）
 */
export async function isProxyEnabled() {
  const now = Date.now()
  if (_cachedUseProxy !== null && (now - _cacheTime) < CACHE_TTL) {
    return _cachedUseProxy
  }
  try {
    const env = getSharedEnv()
    const reader = env.proxyEnabledReader || (async () => false)
    _cachedUseProxy = !!(await reader())
    _cacheTime = now
    return _cachedUseProxy
  } catch (error) {
    logger.error('读取代理配置失败:', error)
    return false
  }
}

/**
 * 清除代理配置缓存（设置变更时调用）
 */
export function clearProxyCache() {
  _cachedUseProxy = null
  _cacheTime = 0
  logger.debug('代理配置缓存已清除')
}

/**
 * 取系统代理 URL（环境变量）
 */
export function getSystemProxyUrl() {
  return process.env.HTTPS_PROXY || process.env.https_proxy ||
         process.env.HTTP_PROXY || process.env.http_proxy ||
         process.env.ALL_PROXY || process.env.all_proxy || null
}

/**
 * 根据配置返回代理 URL（关闭则返回 null）
 */
export async function getProxyUrl() {
  const enabled = await isProxyEnabled()
  if (!enabled) {
    logger.debug('代理已禁用')
    return null
  }
  const proxyUrl = getSystemProxyUrl()
  if (proxyUrl) logger.debug('使用代理:', proxyUrl)
  return proxyUrl
}

/**
 * 为子进程构建环境变量（按代理开关注入/移除 *_PROXY）
 */
export async function buildSubAppEnvironment() {
  const env = { ...process.env }
  const useProxy = await isProxyEnabled()

  if (!useProxy) {
    const proxyVars = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy',
                       'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']
    proxyVars.forEach(key => { delete env[key] })
    logger.debug('代理已禁用，已移除代理环境变量')
  } else {
    logger.debug('代理已启用，传递系统代理设置')
  }

  env._useProxy = String(useProxy)
  return env
}

/**
 * 打印当前代理状态
 */
export async function logProxyStatus() {
  const enabled = await isProxyEnabled()
  const proxyUrl = getSystemProxyUrl()
  logger.info('代理状态:', { enabled, systemProxy: proxyUrl || '未设置' })
}
