/**
 * 加密工具（AES-256-CBC + PBKDF2 派生密钥）
 *
 * 相对原版 electron/utils/encryption.js：
 * - logger import 来源改为 @xingseq/shared-utils
 *
 * 算法说明：
 * - PBKDF2 (sha256, 100000 iter) 派生 32 字节 key
 * - AES-256-CBC + 随机 16 字节 IV
 * - 输出格式："iv_hex:ciphertext_hex"
 */

import crypto from 'crypto'
import { getLogger } from '@xingseq/shared-utils/logger'

const logger = getLogger('Encryption')

const ALGORITHM = 'aes-256-cbc'
const KEY_LENGTH = 32
const IV_LENGTH = 16

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha256')
}

export function generateSalt() {
  return crypto.randomBytes(16).toString('hex')
}

export function encrypt(text, password, salt) {
  if (!text || text === '') return ''
  try {
    const key = deriveKey(password, salt)
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    return `${iv.toString('hex')}:${encrypted}`
  } catch (error) {
    logger.error('加密失败:', error)
    throw new Error('加密失败: ' + error.message)
  }
}

export function decrypt(encryptedText, password, salt) {
  if (!encryptedText || encryptedText === '') return ''
  try {
    const key = deriveKey(password, salt)
    const parts = encryptedText.split(':')
    if (parts.length !== 2) {
      throw new Error('加密数据格式错误')
    }
    const iv = Buffer.from(parts[0], 'hex')
    const encryptedData = parts[1]
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch (error) {
    logger.error('解密失败:', error)
    throw new Error('解密失败: ' + error.message)
  }
}

export function verifyPassword(password, encryptedTest, salt) {
  try {
    decrypt(encryptedTest, password, salt)
    return true
  } catch {
    return false
  }
}

export function generatePasswordTest(password, salt) {
  const testString = 'password_verification_test'
  return encrypt(testString, password, salt)
}
