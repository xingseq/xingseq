/**
 * @xingseq/storage-core
 * L1 基座：原子文件 / AES 加密 / sql.js 数据库
 *
 * 已迁入：
 * - 原子文件：atomicWriteFile / atomicWriteFileSync（来自 electron/utils/atomicFile.js）
 * - AES 加密：generateSalt / encrypt / decrypt / verifyPassword / generatePasswordTest
 * - sql.js 数据库：initDatabase / saveDatabase / getDatabase / closeDatabase / getDatabasePath
 * - 默认 schemas：DEFAULT_CREATE_STATEMENTS / DEFAULT_ALTER_STATEMENTS
 *
 * 未迁入：
 * - encryptionConfigManager.js / emailEncryption.js（业务耦合，归 L2/L3）
 */

// 原子文件
export { atomicWriteFile, atomicWriteFileSync } from './atomicFile.js'

// 加密
export {
  generateSalt,
  encrypt,
  decrypt,
  verifyPassword,
  generatePasswordTest
} from './encryption.js'

// 数据库
export {
  initDatabase,
  saveDatabase,
  getDatabase,
  closeDatabase,
  getDatabasePath,
  __resetForTest
} from './database.js'

// 默认 schemas
export { DEFAULT_CREATE_STATEMENTS, DEFAULT_ALTER_STATEMENTS } from './schemas.js'
