/**
 * JSON 工具 - 安全解析（自动处理 UTF-8 BOM）
 */
import { promises as fs } from 'fs'
import { readFileSync } from 'fs'

const UTF8_BOM = '\uFEFF'

/**
 * 去除字符串开头的 UTF-8 BOM 字节
 */
export function stripBOM(str) {
  if (typeof str !== 'string') return str
  if (str.charCodeAt(0) === 0xFEFF) return str.slice(1)
  return str
}

/**
 * 安全解析 JSON 字符串（自动去 BOM）
 */
export function safeJsonParse(str, context = '') {
  try {
    return JSON.parse(stripBOM(str))
  } catch (error) {
    const contextInfo = context ? ` (${context})` : ''
    error.message = `JSON 解析失败${contextInfo}: ${error.message}`
    throw error
  }
}

/**
 * 安全读取并解析 JSON 文件
 * @param {string} filePath
 * @param {object} [options]
 * @param {any} [options.defaultValue]
 * @param {boolean} [options.throwOnNotFound=true]
 */
export async function readJsonFile(filePath, options = {}) {
  const { defaultValue, throwOnNotFound = true } = options
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return safeJsonParse(content, filePath)
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (defaultValue !== undefined) return defaultValue
      if (!throwOnNotFound) return undefined
    }
    if (defaultValue !== undefined) return defaultValue
    throw error
  }
}

/**
 * 安全写入 JSON 文件
 */
export async function writeJsonFile(filePath, data, options = {}) {
  const { indent = 2, ensureDir = false } = options
  if (ensureDir) {
    const { dirname } = await import('path')
    await fs.mkdir(dirname(filePath), { recursive: true })
  }
  const content = JSON.stringify(data, null, indent)
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * 同步读取并解析 JSON 文件
 */
export function readJsonFileSync(filePath, options = {}) {
  const { defaultValue } = options
  try {
    const content = readFileSync(filePath, 'utf-8')
    return safeJsonParse(content, filePath)
  } catch (error) {
    if (defaultValue !== undefined) return defaultValue
    throw error
  }
}
