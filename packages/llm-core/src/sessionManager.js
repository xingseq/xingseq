/**
 * 会话管理模块 - 管理多会话终止信号
 *
 * 迁入自 electron/ai/sessionManager.js
 * 改动：logger import 改自 @xingseq/shared-utils/logger
 */

import { getLogger } from '@xingseq/shared-utils/logger'

const logger = getLogger('Session')

// 多会话终止信号管理
const abortControllers = new Map() // sessionId -> AbortController

/**
 * 为会话创建终止控制器
 * @param {string} sessionId - 会话ID
 * @returns {AbortController} 终止控制器
 */
export function createSessionController(sessionId) {
  const controller = new AbortController()
  abortControllers.set(sessionId, controller)
  logger.debug(`会话 ${sessionId} 开始请求`)
  return controller
}

/**
 * 终止指定会话的AI回复
 * @param {string} sessionId - 会话ID（标签页ID）
 * @returns {boolean} 是否成功终止
 */
export function abortSession(sessionId) {
  if (!sessionId) {
    logger.warn('abortSession: sessionId 未提供')
    return false
  }

  const controller = abortControllers.get(sessionId)
  if (controller) {
    controller.abort()
    abortControllers.delete(sessionId)
    logger.debug(`会话 ${sessionId} 已终止`)
    return true
  }
  return false
}

/**
 * 清理已完成的会话控制器
 * @param {string} sessionId - 会话ID
 */
export function cleanupSession(sessionId) {
  if (sessionId && abortControllers.has(sessionId)) {
    abortControllers.delete(sessionId)
  }
}

/**
 * 测试用：重置所有会话状态
 * @internal
 */
export function __resetForTest() {
  for (const c of abortControllers.values()) {
    try { c.abort() } catch (_) { /* noop */ }
  }
  abortControllers.clear()
}
