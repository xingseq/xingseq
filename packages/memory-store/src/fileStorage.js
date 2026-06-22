/**
 * 文件存储模块 - 管理对话完整数据文件的读写及数据清理
 *
 * 与 develop 的差异：
 *   - 去掉 timerScheduler / cli/runtime import
 *   - saveDeepSeekData / loadConversation / clearAllData 中 app 改通过 getSharedEnv().getApp() 获取
 *   - clearAllData 不再调用 shutdownScheduler（由上层负责）
 */

import { getLogger } from '@xingseq/shared-utils/logger'
import { getSharedEnv } from '@xingseq/shared-utils/env'
import { safeJsonParse } from '@xingseq/shared-utils/jsonUtils'
import path from 'path'
import { promises as fs } from 'fs'
import { initDatabase, closeDatabase, getDatabase } from '@xingseq/storage-core/database'
import { getConversationFactory } from './conversationManager.js'

const logger = getLogger('FileStorage')

/**
 * 从 shared-utils env 取 app，如未注入则 throw
 */
function requireApp(op) {
  const env = getSharedEnv()
  const app = typeof env.getApp === 'function' ? env.getApp() : null
  if (!app || typeof app.getPath !== 'function') {
    throw new Error(`${op}: getApp 未注入，无法获取用户数据目录。请在初始化时调用 setSharedEnv({ getApp })`)
  }
  return app
}

/**
 * 保存对话完整数据到本地文件
 * @param {string} id - 对话 ID
 * @param {object} data - 要保存的数据
 */
export async function saveDeepSeekData(id, data) {
  try {
    const app = requireApp('saveDeepSeekData')
    const userDataPath = app.getPath('userData')
    const dataDir = path.join(userDataPath, 'data', 'deepseek')

    await fs.mkdir(dataDir, { recursive: true })

    const filePath = path.join(dataDir, `${id}.json`)
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')

    logger.debug(`对话数据已保存: ${filePath}`)
    return { success: true, path: filePath }
  } catch (error) {
    logger.error('保存对话数据失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 加载完整对话数据
 * @param {string} id - 对话 ID
 */
export async function loadConversation(id) {
  try {
    const app = requireApp('loadConversation')
    const userDataPath = app.getPath('userData')
    const filePath = path.join(userDataPath, 'data', 'deepseek', `${id}.json`)

    const content = await fs.readFile(filePath, 'utf-8')
    const data = safeJsonParse(content, filePath)

    logger.debug(`对话数据已加载: ${id}`)
    return { success: true, data }
  } catch (error) {
    logger.error('加载对话数据失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 清除所有数据（关闭数据库 + 删除数据目录 + 重新初始化）
 * 注意：不再调用 shutdownScheduler，由上层决定是否先停调度器。
 */
export async function clearAllData() {
  try {
    const app = requireApp('clearAllData')
    const userDataPath = app.getPath('userData')
    const dataDir = path.join(userDataPath, 'data')

    closeDatabase()

    try {
      await fs.rm(dataDir, { recursive: true, force: true })
      logger.debug(`数据目录已删除: ${dataDir}`)
    } catch (err) {
      logger.warn('删除数据目录失败:', err)
    }

    await initDatabase()

    logger.info('所有数据已清除')
    return { success: true }
  } catch (error) {
    logger.error('清除数据失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 自动清理超过30天的已删除对话
 */
export async function cleanupOldDeletedConversations() {
  try {
    await initDatabase()
    const db = getDatabase()

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const cutoffDate = thirtyDaysAgo.toISOString()

    const result = db.exec(`
      SELECT id
      FROM conversations_global
      WHERE deleted_at IS NOT NULL AND deleted_at < '${cutoffDate}'
    `)

    let cleanedCount = 0
    if (result.length > 0 && result[0].values.length > 0) {
      const idsToClean = result[0].values.map(row => row[0])
      const factory = getConversationFactory()
      for (const id of idsToClean) {
        const manager = factory.getManager(null)
        const deleteResult = await manager.permanentDelete(id)
        if (deleteResult.success) cleanedCount++
      }
    }

    logger.info(`自动清理完成，删除了 ${cleanedCount} 条超过30天的对话`)
    return { success: true, count: cleanedCount }
  } catch (error) {
    logger.error('自动清理失败:', error)
    return { success: false, count: 0, error: error.message }
  }
}

