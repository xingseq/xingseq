/**
 * 分岔路径管理模块
 *
 * 与 develop 的差异：
 *   - logger/database import 改自 workspace 包
 */

import { getLogger } from '@xingseq/shared-utils/logger'
import { initDatabase, saveDatabase, getDatabase, getDatabasePath } from '@xingseq/storage-core/database'

const logger = getLogger('ForkPath')

/**
 * 分岔路径管理器
 */
class ForkPathManager {
  constructor(projectId = null) {
    this.projectId = projectId
  }

  /**
   * 保存分岔路径记录
   * @param {Object} forkInfo - { sourceConversationId, forkedConversationId, forkType, messageIndex? }
   */
  async saveForkPath(forkInfo) {
    try {
      await initDatabase()
      const db = getDatabase()

      const { sourceConversationId, forkedConversationId, forkType, messageIndex = null } = forkInfo
      const id = `fork-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const createdAt = new Date().toISOString()

      db.run(
        `INSERT INTO conversation_forks (id, source_conversation_id, forked_conversation_id, fork_type, fork_message_index, project_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, sourceConversationId, forkedConversationId, forkType, messageIndex, this.projectId, createdAt]
      )

      const dbPath = await getDatabasePath()
      await saveDatabase(dbPath)

      logger.debug(`分岔路径已保存: ${sourceConversationId} -> ${forkedConversationId}`)
      return { success: true, id }
    } catch (error) {
      logger.error('保存分岔路径失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 获取某个话题的所有分岔记录（作为源话题）
   */
  async getForksBySource(conversationId) {
    try {
      await initDatabase()
      const db = getDatabase()

      const result = db.exec(`
        SELECT id, source_conversation_id, forked_conversation_id, fork_type, fork_message_index, project_id, created_at
        FROM conversation_forks
        WHERE source_conversation_id = ?
        ORDER BY created_at DESC
      `, [conversationId])

      let forks = []
      if (result.length > 0 && result[0].values.length > 0) {
        const columns = result[0].columns
        forks = result[0].values.map(row => {
          const obj = {}
          columns.forEach((col, idx) => { obj[col] = row[idx] })
          return obj
        })
      }

      return { success: true, data: forks }
    } catch (error) {
      logger.error('获取分岔记录失败:', error)
      return { success: false, error: error.message, data: [] }
    }
  }

  /**
   * 获取某个话题的源话题信息（作为分岔后的话题）
   */
  async getForkSource(conversationId) {
    try {
      await initDatabase()
      const db = getDatabase()

      const result = db.exec(`
        SELECT id, source_conversation_id, forked_conversation_id, fork_type, fork_message_index, project_id, created_at
        FROM conversation_forks
        WHERE forked_conversation_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `, [conversationId])

      let fork = null
      if (result.length > 0 && result[0].values.length > 0) {
        const columns = result[0].columns
        const row = result[0].values[0]
        fork = {}
        columns.forEach((col, idx) => { fork[col] = row[idx] })
      }

      return { success: true, data: fork }
    } catch (error) {
      logger.error('获取源话题失败:', error)
      return { success: false, error: error.message, data: null }
    }
  }

  /**
   * 获取分岔路径树（从指定话题开始的所有分岔）
   */
  async getForkTree(conversationId) {
    try {
      await initDatabase()
      const db = getDatabase()

      const getAllForks = (sourceId, visited = new Set()) => {
        if (visited.has(sourceId)) return []
        visited.add(sourceId)

        const result = db.exec(`
          SELECT id, source_conversation_id, forked_conversation_id, fork_type, fork_message_index, project_id, created_at
          FROM conversation_forks
          WHERE source_conversation_id = ?
          ORDER BY created_at ASC
        `, [sourceId])

        let forks = []
        if (result.length > 0 && result[0].values.length > 0) {
          const columns = result[0].columns
          forks = result[0].values.map(row => {
            const obj = {}
            columns.forEach((col, idx) => { obj[col] = row[idx] })
            obj.children = getAllForks(obj.forked_conversation_id, visited)
            return obj
          })
        }
        return forks
      }

      const tree = getAllForks(conversationId)
      return { success: true, data: tree }
    } catch (error) {
      logger.error('获取分岔路径树失败:', error)
      return { success: false, error: error.message, data: [] }
    }
  }
}

/**
 * 分岔路径管理器工厂
 */
class ForkPathManagerFactory {
  constructor() {
    this.managers = new Map()
  }

  getManager(projectId = null) {
    if (!this.managers.has(projectId)) {
      this.managers.set(projectId, new ForkPathManager(projectId))
    }
    return this.managers.get(projectId)
  }

  removeManager(projectId) {
    if (projectId !== null) {
      this.managers.delete(projectId)
    }
  }
}

const forkPathFactory = new ForkPathManagerFactory()

/** 获取分岔路径管理器工厂实例 */
export function getForkPathFactory() {
  return forkPathFactory
}
