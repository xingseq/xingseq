/**
 * sql.js 数据库管理（裁剪自 develop electron/data/database.js）
 *
 * 相对原版的差异：
 * 1. 解耦 cli/runtime.js：通过 shared-utils 的 env.getApp 取 userData
 * 2. schemas 抽到 schemas.js，initDatabase 接收 { dbPath?, schemas? } 参数
 *    便于上层注入自定义路径与 schema
 * 3. logger 来自 @xingseq/shared-utils
 */

import path from 'path'
import { promises as fs } from 'fs'
import initSqlJs from 'sql.js'
import { getLogger } from '@xingseq/shared-utils/logger'
import { getSharedEnv } from '@xingseq/shared-utils/env'
import { DEFAULT_CREATE_STATEMENTS, DEFAULT_ALTER_STATEMENTS } from './schemas.js'

const logger = getLogger('Database')

let db = null
let SQL = null
let _userDataPath = null
let _currentDbPath = null

async function getUserDataPath() {
  if (_userDataPath) return _userDataPath
  const env = getSharedEnv()
  if (!env.getApp) {
    throw new Error('[storage-core/database] 未注入 getApp，请在壳层启动时调用 setSharedEnv({ getApp })')
  }
  const app = await env.getApp()
  _userDataPath = app.getPath('userData')
  return _userDataPath
}

/**
 * 初始化数据库
 * @param {Object} [options]
 * @param {string} [options.dbPath] 显式数据库路径。未提供时落到 <userData>/data/conversations.db
 * @param {string[]} [options.createStatements] 覆盖默认 CREATE 语句集
 * @param {string[]} [options.alterStatements]  覆盖默认 ALTER 语句集
 * @param {Object}   [options.sqlJsConfig]      传给 initSqlJs 的配置（含 locateFile）
 * @returns {Promise<any>} sql.js Database 实例
 */
export async function initDatabase(options = {}) {
  if (db) return db
  try {
    if (!SQL) {
      SQL = await initSqlJs(options.sqlJsConfig || undefined)
    }

    const dbPath = options.dbPath
      ? options.dbPath
      : path.join(await getUserDataPath(), 'data', 'conversations.db')

    _currentDbPath = dbPath
    await fs.mkdir(path.dirname(dbPath), { recursive: true })

    let dbData = null
    try {
      dbData = await fs.readFile(dbPath)
    } catch (_) { /* 不存在，新建 */ }

    db = new SQL.Database(dbData)

    const creates = options.createStatements || DEFAULT_CREATE_STATEMENTS
    for (const sql of creates) {
      db.run(sql)
    }
    const alters = options.alterStatements || DEFAULT_ALTER_STATEMENTS
    for (const sql of alters) {
      try { db.run(sql) } catch (_) { /* 列已存在，忽略 */ }
    }

    await saveDatabase(dbPath)
    logger.info(`数据库已初始化: ${dbPath}`)
    return db
  } catch (error) {
    logger.error('初始化数据库失败:', error)
    throw error
  }
}

/**
 * 保存数据库到文件
 * @param {string} [dbPath] 不传时使用最近一次 init 的路径
 */
export async function saveDatabase(dbPath) {
  if (!db) return
  const target = dbPath || _currentDbPath
  if (!target) {
    logger.warn('saveDatabase 调用时无可用 dbPath')
    return
  }
  try {
    const data = db.export()
    const buffer = Buffer.from(data)
    await fs.writeFile(target, buffer)
  } catch (error) {
    logger.error('保存数据库失败:', error)
  }
}

export function getDatabase() {
  return db
}

export function closeDatabase() {
  if (db) {
    db.close()
    db = null
  }
}

export async function getDatabasePath() {
  if (_currentDbPath) return _currentDbPath
  const userDataPath = await getUserDataPath()
  return path.join(userDataPath, 'data', 'conversations.db')
}

/**
 * 测试用：重置内部状态（不会动磁盘）
 */
export function __resetForTest() {
  if (db) { try { db.close() } catch (_) {} }
  db = null
  SQL = null
  _userDataPath = null
  _currentDbPath = null
}
