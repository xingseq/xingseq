/**
 * 对话管理模块 - 管理对话数据的 CRUD 操作
 *
 * 与 develop 的差异：
 *   - 去掉对 electron/cli/runtime.js 的 import
 *   - permanentDelete 中删文件时通过 getSharedEnv().getApp() 获取 userDataPath
 *     若 getApp 未注入则跳过文件删除（仅删 DB 记录）
 */

import { getLogger } from '@xingseq/shared-utils/logger'
import { getSharedEnv } from '@xingseq/shared-utils/env'
import path from 'path'
import { promises as fs } from 'fs'
import { initDatabase, saveDatabase, getDatabase, getDatabasePath } from '@xingseq/storage-core/database'

const logger = getLogger('Conversation')

/**
 * 对话管理类 - 管理单个表的对话数据
 */
class ConversationManager {
  constructor(projectId = null) {
    this.projectId = projectId
    // 将 projectId 中的 - 替换为 _，确保 SQL 表名合法
    const safeProjectId = projectId ? projectId.replace(/-/g, '_') : null
    this.tableName = safeProjectId ? `conversations_${safeProjectId}` : 'conversations_global'
  }

  /**
   * 创建对话表
   */
  async createTable() {
    try {
      await initDatabase()
      const db = getDatabase()

      db.run(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          preview TEXT,
          date TEXT,
          source TEXT,
          imported INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          deleted_at DATETIME DEFAULT NULL
        )
      `)

      const dbPath = await getDatabasePath()
      await saveDatabase(dbPath)

      logger.debug(`对话表已创建: ${this.tableName}`)
      return { success: true }
    } catch (error) {
      logger.error('创建对话表失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 删除对话表
   */
  async deleteTable() {
    try {
      await initDatabase()
      const db = getDatabase()

      db.run(`DROP TABLE IF EXISTS ${this.tableName}`)

      const dbPath = await getDatabasePath()
      await saveDatabase(dbPath)

      logger.debug(`对话表已删除: ${this.tableName}`)
      return { success: true }
    } catch (error) {
      logger.error('删除对话表失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 保存对话索引
   */
  async save(conversation) {
    try {
      await initDatabase()
      const db = getDatabase()

      // 如果是项目表，先确保表存在
      if (this.projectId) {
        await this.createTable()
      }

      const { id, title, preview = '', date, source = 'deepseek', created_at, updated_at } = conversation
      const createdAt = created_at || new Date().toISOString()
      const updatedAt = updated_at || new Date().toISOString()

      db.run(
        `INSERT OR REPLACE INTO ${this.tableName} (id, title, preview, date, source, imported, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [id, title, preview, date, source, createdAt, updatedAt]
      )

      const dbPath = await getDatabasePath()
      await saveDatabase(dbPath)

      logger.debug(`对话索引已保存: ${id} - ${title} (表: ${this.tableName})`)
      return { success: true }
    } catch (error) {
      logger.error('保存对话索引失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 获取所有对话列表（未删除）
   */
  async getAll() {
    try {
      await initDatabase()
      const db = getDatabase()

      // 如果是项目表，先确保表存在（避免 "no such table" 错误）
      if (this.projectId) {
        await this.createTable()
      }

      const result = db.exec(`
        SELECT id, title, preview, date, source, imported, created_at, updated_at
        FROM ${this.tableName}
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC
      `)

      let conversations = []
      if (result.length > 0 && result[0].values.length > 0) {
        const columns = result[0].columns
        conversations = result[0].values.map(row => {
          const obj = {}
          columns.forEach((col, idx) => { obj[col] = row[idx] })
          return obj
        })
      }

      return { success: true, data: conversations }
    } catch (error) {
      logger.error('获取对话列表失败:', error)
      return { success: false, error: error.message, data: [] }
    }
  }

  /**
   * 删除对话（软删除）
   */
  async delete(id) {
    try {
      await initDatabase()
      const db = getDatabase()

      const deletedAt = new Date().toISOString()
      db.run(
        `UPDATE ${this.tableName} SET deleted_at = ? WHERE id = ?`,
        [deletedAt, id]
      )

      const dbPath = await getDatabasePath()
      await saveDatabase(dbPath)

      logger.debug(`对话已删除: ${id}`)
      return { success: true }
    } catch (error) {
      logger.error('删除对话失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 恢复对话
   */
  async restore(id) {
    try {
      await initDatabase()
      const db = getDatabase()

      const updatedAt = new Date().toISOString()
      db.run(
        `UPDATE ${this.tableName} SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
        [updatedAt, id]
      )

      const dbPath = await getDatabasePath()
      await saveDatabase(dbPath)

      logger.debug(`对话已恢复: ${id}`)
      return { success: true }
    } catch (error) {
      logger.error('恢复对话失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 获取回收站对话列表
   */
  async getDeleted() {
    try {
      await initDatabase()
      const db = getDatabase()

      const result = db.exec(`
        SELECT id, title, preview, date, source, imported, created_at, updated_at, deleted_at
        FROM ${this.tableName}
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
      `)

      let conversations = []
      if (result.length > 0 && result[0].values.length > 0) {
        const columns = result[0].columns
        conversations = result[0].values.map(row => {
          const obj = {}
          columns.forEach((col, idx) => { obj[col] = row[idx] })
          return obj
        })
      }

      return { success: true, data: conversations }
    } catch (error) {
      logger.error('获取回收站列表失败:', error)
      return { success: false, error: error.message, data: [] }
    }
  }

  /**
   * 永久删除对话
   *
   * 若 getSharedEnv().getApp() 存在，同时删除对话数据文件；
   * 否则仅删除 DB 记录（CLI 测试场景）。
   */
  async permanentDelete(id) {
    try {
      await initDatabase()
      const db = getDatabase()

      db.run(`DELETE FROM ${this.tableName} WHERE id = ?`, [id])

      // 尝试删除数据文件（需要 getApp 注入）
      try {
        const env = getSharedEnv()
        const app = typeof env.getApp === 'function' ? env.getApp() : null
        if (app && typeof app.getPath === 'function') {
          const userDataPath = app.getPath('userData')
          const dataFilePath = path.join(userDataPath, 'data', 'deepseek', `${id}.json`)
          await fs.unlink(dataFilePath).catch(err => {
            logger.warn('删除数据文件失败:', err.message)
          })
          logger.debug(`数据文件已删除: ${dataFilePath}`)
        }
      } catch (err) {
        logger.warn('获取 app 失败，跳过文件删除:', err.message)
      }

      const dbPath = await getDatabasePath()
      await saveDatabase(dbPath)

      logger.debug(`对话已永久删除: ${id}`)
      return { success: true }
    } catch (error) {
      logger.error('永久删除对话失败:', error)
      return { success: false, error: error.message }
    }
  }
}

/**
 * 对话管理器工厂类 - 管理所有项目的对话管理器实例
 */
class ConversationManagerFactory {
  constructor() {
    this.managers = new Map()
    // 创建全局对话管理器
    this.managers.set(null, new ConversationManager(null))
  }

  /** 获取指定项目的对话管理器 */
  getManager(projectId = null) {
    if (!this.managers.has(projectId)) {
      this.managers.set(projectId, new ConversationManager(projectId))
    }
    return this.managers.get(projectId)
  }

  /** 移除项目对话管理器 */
  removeManager(projectId) {
    if (projectId !== null) {
      this.managers.delete(projectId)
    }
  }
}

// 全局工厂单例
const conversationFactory = new ConversationManagerFactory()

/** 获取对话管理器工厂实例 */
export function getConversationFactory() {
  return conversationFactory
}

