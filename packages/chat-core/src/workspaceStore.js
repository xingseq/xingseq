/**
 * workspace 级对话历史存储
 *
 * 设计目标：
 *   - 每个 workspace 拥有独立的对话历史（切换 workspace = 切换记忆）
 *   - 自包含：一个 workspace 目录拷走就是完整的对话集（不依赖全局 SQLite）
 *   - 简单：纯 JSON 文件，无外部数据库依赖
 *
 * 数据布局：
 *   <memoryDir>/
 *     ├── index.json                       对话索引数组 [{ id, title, preview, updatedAt, messageCount }]
 *     └── conversations/<id>.json          单条完整对话 { id, title, messages, updatedAt }
 *
 * 与 memory-store 的关系：
 *   memory-store 仍是"app 全局"语义（主记忆 / 通知 / 跨 workspace 索引等场景）。
 *   本模块只负责 workspace 维度的对话历史，避免与 memory-store 的全局索引语义冲突。
 */

import path from 'node:path'
import { promises as fs, existsSync } from 'node:fs'
import { getLogger } from '@xingseq/shared-utils/logger'

const logger = getLogger('WorkspaceStore')

const INDEX_FILE = 'index.json'
const CONV_DIR = 'conversations'

async function readIndex(memoryDir) {
  const file = path.join(memoryDir, INDEX_FILE)
  if (!existsSync(file)) return []
  try {
    const content = await fs.readFile(file, 'utf-8')
    const arr = JSON.parse(content)
    return Array.isArray(arr) ? arr : []
  } catch (err) {
    logger.warn(`索引文件损坏，已忽略：${file}`, err)
    return []
  }
}

async function writeIndex(memoryDir, list) {
  const file = path.join(memoryDir, INDEX_FILE)
  await fs.writeFile(file, JSON.stringify(list, null, 2), 'utf-8')
}

function pickPreview(messages) {
  const lastVisible = [...messages].reverse().find(
    m => (m.role === 'user' || m.role === 'assistant')
      && typeof m.content === 'string'
      && m.content.trim()
  )
  return (lastVisible?.content || '').slice(0, 80)
}

/**
 * 创建一个绑定到指定 memoryDir 的 store
 *
 * @param {string} memoryDir - workspace 的 memory 目录绝对路径
 */
export function createWorkspaceStore(memoryDir) {
  if (!memoryDir) throw new Error('createWorkspaceStore: memoryDir 必填')

  const convDir = path.join(memoryDir, CONV_DIR)

  async function ensureDirs() {
    await fs.mkdir(convDir, { recursive: true })
  }

  /**
   * 保存对话（更新索引 + 写单条文件）
   * @param {{ id, title, messages }} data
   */
  async function saveConversation(data) {
    if (!data?.id) throw new Error('saveConversation: id 必填')
    await ensureDirs()
    const updatedAt = new Date().toISOString()

    // 写单条
    const file = path.join(convDir, `${data.id}.json`)
    await fs.writeFile(file, JSON.stringify({
      id: data.id,
      title: data.title || '',
      messages: data.messages || [],
      updatedAt
    }, null, 2), 'utf-8')

    // 更新索引
    const list = await readIndex(memoryDir)
    const entry = {
      id: data.id,
      title: data.title || '',
      preview: pickPreview(data.messages || []),
      updatedAt,
      messageCount: (data.messages || []).length
    }
    const idx = list.findIndex(c => c.id === data.id)
    if (idx >= 0) list[idx] = entry
    else list.unshift(entry)
    await writeIndex(memoryDir, list)

    return { success: true, path: file }
  }

  /**
   * 加载对话
   */
  async function loadConversation(id) {
    if (!id) return { success: false, error: 'id 必填' }
    const file = path.join(convDir, `${id}.json`)
    if (!existsSync(file)) return { success: false, error: `对话 ${id} 不存在` }
    try {
      const content = await fs.readFile(file, 'utf-8')
      const data = JSON.parse(content)
      return { success: true, data }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /**
   * 列出索引（按 updatedAt desc）
   */
  async function listConversations({ limit = 50 } = {}) {
    const list = await readIndex(memoryDir)
    return list
      .slice()
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, limit)
  }

  /**
   * 删除对话（同时移除索引和文件）
   */
  async function deleteConversation(id) {
    if (!id) return { success: false, error: 'id 必填' }
    const file = path.join(convDir, `${id}.json`)
    if (existsSync(file)) await fs.rm(file, { force: true })
    const list = await readIndex(memoryDir)
    const next = list.filter(c => c.id !== id)
    if (next.length !== list.length) await writeIndex(memoryDir, next)
    return { success: true }
  }

  return {
    saveConversation,
    loadConversation,
    listConversations,
    deleteConversation
  }
}
