/**
 * 通知消息存储服务
 *
 * 与 develop 的差异：
 *   - 去掉 cli/runtime 和 electron require 的动态加载
 *   - 通过 getSharedEnv().getApp() 获取 userDataPath
 *   - 若 getApp 未注入，则 fallback 到 NAJIE_USER_DATA_PATH 环境变量
 *   - 不再用 createRequire，直接用 ES module import
 */

import path from 'path'
import { promises as fs } from 'fs'
import { getLogger } from '@xingseq/shared-utils/logger'
import { getSharedEnv } from '@xingseq/shared-utils/env'

const logger = getLogger('MessageStorage')
const MAX_MESSAGES = 100

/**
 * 获取消息文件路径
 * 优先级：getSharedEnv().getApp() > NAJIE_USER_DATA_PATH 环境变量
 */
export function getMessageFilePath() {
  // 1. 通过注入的 getApp 获取（Electron 主进程 / 上层已注入场景）
  try {
    const env = getSharedEnv()
    const app = typeof env.getApp === 'function' ? env.getApp() : null
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'data', 'messages.json')
    }
  } catch {
    // 忽略
  }

  // 2. Agent 子进程：使用 Electron 注入的环境变量
  const userDataBase = process.env.NAJIE_USER_DATA_PATH
  if (userDataBase) {
    return path.join(userDataBase, 'messages.json')
  }

  throw new Error(
    'messageStorage: 无法确定消息文件路径。' +
    '请调用 setSharedEnv({ getApp }) 注入 app，或设置 NAJIE_USER_DATA_PATH 环境变量。'
  )
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
}

async function readMessages() {
  const filePath = getMessageFilePath()
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const data = JSON.parse(content)
    return data && Array.isArray(data.messages) ? data : { messages: [] }
  } catch (err) {
    if (err.code === 'ENOENT') return { messages: [] }
    logger.warn('读取消息文件失败:', err.message)
    return { messages: [] }
  }
}

async function writeMessages(data) {
  const filePath = getMessageFilePath()
  await ensureDir(filePath)

  const content = JSON.stringify(data, null, 2)
  const tmpPath = filePath + '.tmp'
  try {
    await fs.writeFile(tmpPath, content, 'utf-8')
    await fs.rename(tmpPath, filePath)
  } catch {
    await fs.writeFile(filePath, content, 'utf-8')
  }
}

function generateId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`
}

/**
 * 添加一条通知消息
 * @param {{ type, title, content, provider?, url? }} msg
 */
export async function addMessage(msg) {
  const data = await readMessages()

  const message = {
    id: generateId(),
    type: msg.type || 'info',
    title: msg.title || '',
    content: msg.content || '',
    provider: msg.provider || '',
    url: msg.url || '',
    read: false,
    createdAt: new Date().toISOString()
  }

  data.messages.unshift(message)
  if (data.messages.length > MAX_MESSAGES) {
    data.messages = data.messages.slice(0, MAX_MESSAGES)
  }

  await writeMessages(data)
  return message
}

/** 获取所有消息 */
export async function getMessages() {
  const data = await readMessages()
  return data.messages
}

/** 获取未读消息数量 */
export async function getUnreadCount() {
  const data = await readMessages()
  return data.messages.filter(m => !m.read).length
}

/** 标记单条消息为已读 */
export async function markAsRead(id) {
  const data = await readMessages()
  const msg = data.messages.find(m => m.id === id)
  if (msg) {
    msg.read = true
    await writeMessages(data)
  }
}

/** 标记所有消息为已读 */
export async function markAllAsRead() {
  const data = await readMessages()
  data.messages.forEach(m => { m.read = true })
  await writeMessages(data)
}

/** 删除一条消息 */
export async function deleteMessage(id) {
  const data = await readMessages()
  data.messages = data.messages.filter(m => m.id !== id)
  await writeMessages(data)
}

/** 清空所有消息 */
export async function clearAll() {
  await writeMessages({ messages: [] })
}

/**
 * 充值链接映射
 * @param {string} provider
 */
export function getRechargeUrl(provider) {
  const urls = {
    deepseek: 'https://platform.deepseek.com',
    kimi: 'https://platform.moonshot.cn',
    qwen: 'https://dashscope.console.aliyun.com',
    doubao: 'https://console.volcengine.com/ark',
    openai: 'https://platform.openai.com/account/billing'
  }
  return urls[provider?.toLowerCase()] || ''
}
