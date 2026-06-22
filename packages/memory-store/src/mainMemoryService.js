/**
 * 主应用记忆服务
 *
 * 与 develop 的差异：
 *   - 去掉 cli/runtime.js 的 app import
 *   - 通过 getSharedEnv().getApp() 获取 userData 路径
 *   - safeJsonParse 改自 @xingseq/shared-utils/jsonUtils
 */

import { promises as fs } from 'fs'
import path from 'path'
import { getLogger } from '@xingseq/shared-utils/logger'
import { getSharedEnv } from '@xingseq/shared-utils/env'
import { safeJsonParse } from '@xingseq/shared-utils/jsonUtils'

const logger = getLogger('MainMemoryService')

export const MEMORY_TYPES = {
  ARCHITECTURE_DECISION: 'architecture_decision',
  PROBLEM_SOLUTION: 'problem_solution',
  CODE_CONVENTION: 'code_convention',
  KEY_UNDERSTANDING: 'key_understanding',
  TODO: 'todo',
  FEATURE_UPDATE: 'feature_update',
  USER_PREFERENCE: 'user_preference'
}

export const PRIORITY = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
}

let memoriesPath = null

function getMemoriesPath() {
  if (!memoriesPath) {
    const env = getSharedEnv()
    const app = typeof env.getApp === 'function' ? env.getApp() : null
    if (!app || typeof app.getPath !== 'function') {
      throw new Error('mainMemoryService: getApp 未注入，请调用 setSharedEnv({ getApp })')
    }
    memoriesPath = path.join(app.getPath('userData'), 'data', 'main_memories')
  }
  return memoriesPath
}

/** 供测试重置路径缓存 */
export function __resetMemoriesPath() {
  memoriesPath = null
}

async function ensureMemoriesDir() {
  const basePath = getMemoriesPath()
  const entriesPath = path.join(basePath, 'entries')
  await fs.mkdir(entriesPath, { recursive: true })
}

async function loadIndex() {
  const indexPath = path.join(getMemoriesPath(), 'index.json')
  try {
    const data = await fs.readFile(indexPath, 'utf-8')
    return safeJsonParse(data, indexPath) || { memories: [], lastUpdated: null }
  } catch {
    return { memories: [], lastUpdated: null }
  }
}

async function saveIndex(index) {
  await ensureMemoriesDir()
  const indexPath = path.join(getMemoriesPath(), 'index.json')
  index.lastUpdated = new Date().toISOString()
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8')
}

/** 获取所有记忆 */
export async function getAllMemories() {
  try {
    const basePath = getMemoriesPath()
    const index = await loadIndex()
    const memories = []

    for (const entry of index.memories) {
      const entryPath = path.join(basePath, 'entries', `${entry.id}.json`)
      try {
        const data = await fs.readFile(entryPath, 'utf-8')
        memories.push(safeJsonParse(data, entryPath))
      } catch {
        logger.warn(`记忆条目不存在: ${entry.id}`)
      }
    }

    return { success: true, data: memories }
  } catch (error) {
    logger.error('获取主应用记忆失败:', error)
    return { success: false, error: error.message }
  }
}

/** 添加新记忆 */
export async function addMemory(memory) {
  try {
    await ensureMemoriesDir()
    const basePath = getMemoriesPath()

    const id = `main_mem_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
    const now = new Date().toISOString()

    const fullMemory = {
      id,
      type: memory.type || MEMORY_TYPES.KEY_UNDERSTANDING,
      title: memory.title,
      content: memory.content,
      keywords: memory.keywords || [],
      priority: memory.priority || PRIORITY.MEDIUM,
      source: memory.source || {},
      createdAt: now,
      updatedAt: now,
      status: 'active'
    }

    const entryPath = path.join(basePath, 'entries', `${id}.json`)
    await fs.writeFile(entryPath, JSON.stringify(fullMemory, null, 2), 'utf-8')

    const index = await loadIndex()
    index.memories.push({
      id,
      type: fullMemory.type,
      title: fullMemory.title,
      keywords: fullMemory.keywords,
      priority: fullMemory.priority,
      createdAt: now
    })
    await saveIndex(index)

    logger.info(`添加主应用记忆: ${fullMemory.title}`)
    return { success: true, data: fullMemory }
  } catch (error) {
    logger.error('添加主应用记忆失败:', error)
    return { success: false, error: error.message }
  }
}

/** 批量添加记忆 */
export async function addMemories(memories) {
  const results = []
  for (const memory of memories) {
    const result = await addMemory(memory)
    if (result.success) results.push(result.data)
  }
  return { success: true, data: results, count: results.length }
}

/** 更新记忆 */
export async function updateMemory(memoryId, updates) {
  try {
    const basePath = getMemoriesPath()
    const entryPath = path.join(basePath, 'entries', `${memoryId}.json`)

    const data = await fs.readFile(entryPath, 'utf-8')
    const memory = safeJsonParse(data, entryPath)

    const updatedMemory = {
      ...memory,
      ...updates,
      id: memoryId,
      updatedAt: new Date().toISOString()
    }

    await fs.writeFile(entryPath, JSON.stringify(updatedMemory, null, 2), 'utf-8')

    const index = await loadIndex()
    const indexEntry = index.memories.find(m => m.id === memoryId)
    if (indexEntry) {
      indexEntry.title = updatedMemory.title
      indexEntry.keywords = updatedMemory.keywords
      indexEntry.priority = updatedMemory.priority
      await saveIndex(index)
    }

    logger.info(`更新主应用记忆: ${memoryId}`)
    return { success: true, data: updatedMemory }
  } catch (error) {
    logger.error(`更新主应用记忆失败 [${memoryId}]:`, error)
    return { success: false, error: error.message }
  }
}

/** 删除记忆 */
export async function deleteMemory(memoryId) {
  try {
    const basePath = getMemoriesPath()
    const entryPath = path.join(basePath, 'entries', `${memoryId}.json`)

    await fs.unlink(entryPath)

    const index = await loadIndex()
    index.memories = index.memories.filter(m => m.id !== memoryId)
    await saveIndex(index)

    logger.info(`删除主应用记忆: ${memoryId}`)
    return { success: true }
  } catch (error) {
    logger.error(`删除主应用记忆失败 [${memoryId}]:`, error)
    return { success: false, error: error.message }
  }
}

/** 检索相关记忆 */
export async function retrieveMemories(query, options = {}) {
  const { limit = 15, taskType = null } = options

  const result = await getAllMemories()
  if (!result.success) return result

  const memories = result.data.filter(m => m.status === 'active')
  const queryKeywords = extractKeywords(query)

  const scored = memories.map(memory => ({
    memory,
    score: calculateRelevanceScore(memory, { queryKeywords, taskType, currentTime: Date.now() })
  }))

  const topMemories = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .filter(s => s.score > 0)
    .map(s => s.memory)

  return { success: true, data: topMemories }
}

function extractKeywords(text) {
  if (!text) return []
  const words = text
    .toLowerCase()
    .split(/[\s,，.。!！?？;；:：、\-_]+/)
    .filter(w => w.length >= 2)
  return [...new Set(words)]
}

function calculateRelevanceScore(memory, context) {
  let score = 0

  if (memory.priority === PRIORITY.HIGH) score += 30
  else if (memory.priority === PRIORITY.MEDIUM) score += 15
  else score += 5

  const memoryKeywords = (memory.keywords || []).map(k => k.toLowerCase())
  const titleWords = extractKeywords(memory.title)
  const allMemoryWords = [...memoryKeywords, ...titleWords]

  const keywordMatches = context.queryKeywords.filter(qk =>
    allMemoryWords.some(mk => mk.includes(qk) || qk.includes(mk))
  ).length
  score += keywordMatches * 20

  if (memory.createdAt) {
    const ageInDays = (context.currentTime - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    if (ageInDays < 7) score += 10
    else if (ageInDays < 30) score += 5
  }

  return score
}

/** 构建记忆提取提示词 */
export function buildMemoryExtractionPrompt(messages) {
  const conversationText = messages
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n\n')

  return {
    systemPrompt: `你是一个智能助手，负责从对话中提取值得保存的关键信息。

提取标准：
1. 架构决策 (architecture_decision)：明确选择了某种设计方案
2. 问题解决 (problem_solution)：发现问题并找到了解决方案
3. 代码约定 (code_convention)：达成了某种规范或约定
4. 关键理解 (key_understanding)：对业务逻辑的关键理解
5. 待办事项 (todo)：明确提到需要后续处理的事项
6. 功能更新 (feature_update)：新增或修改了某个功能
7. 用户偏好 (user_preference)：用户表达的偏好或习惯

只提取真正有价值的信息，不要提取闲聊或重复内容。

输出格式（JSON 数组）：
[
  {
    "type": "architecture_decision",
    "title": "简短标题（10字以内）",
    "content": "详细内容（包含背景、决策、理由）",
    "keywords": ["关键词1", "关键词2"],
    "priority": "high|medium|low"
  }
]

如果对话中没有值得保存的内容，返回空数组 []`,
    userPrompt: `请分析以下对话内容，提取值得保存的关键记忆：\n\n${conversationText}`
  }
}

/** 解析 AI 返回的记忆 JSON 并保存 */
export async function parseAndSaveMemories(aiResponse, source = {}) {
  try {
    let memories = []

    try {
      memories = JSON.parse(aiResponse)
    } catch {
      const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) {
        memories = JSON.parse(jsonMatch[1].trim())
      } else {
        const arrayMatch = aiResponse.match(/\[[\s\S]*\]/)
        if (arrayMatch) memories = JSON.parse(arrayMatch[0])
      }
    }

    if (!Array.isArray(memories) || memories.length === 0) {
      return { success: true, data: { extracted: 0, saved: 0, memories: [] } }
    }

    const validMemories = memories
      .filter(m => m && m.title && m.content)
      .map(m => ({
        type: m.type || MEMORY_TYPES.KEY_UNDERSTANDING,
        title: String(m.title).slice(0, 50),
        content: String(m.content),
        keywords: Array.isArray(m.keywords) ? m.keywords : [],
        priority: ['high', 'medium', 'low'].includes(m.priority) ? m.priority : PRIORITY.MEDIUM,
        source: { ...source, autoExtracted: true, extractedAt: new Date().toISOString() }
      }))

    const result = await addMemories(validMemories)

    logger.info(`自动提取主应用记忆: ${validMemories.length} 条`)

    return {
      success: true,
      data: { extracted: memories.length, saved: result.count || 0, memories: result.data || [] }
    }
  } catch (error) {
    logger.error('解析并保存主应用记忆失败:', error)
    return { success: false, error: error.message }
  }
}
