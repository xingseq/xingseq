/**
 * skill-host/sources.js
 * 商店源持久化：官方源内置不可删，第三方源落盘 store-sources.json
 *
 * 存储路径：projectsDir 的父目录（默认 ~/Library/Application Support/xingseq/store-sources.json）
 * 数据结构：{ version: 1, sources: [{ id, name, url, enabled, addedAt }] }
 * 官方源为内存常量（不落盘、不可删除/禁用），读取时始终排在首位。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getLogger } from '@xingseq/shared-utils/logger'
import { DEFAULT_REGISTRY_URL, fetchRemoteRegistry } from './registry.js'

const logger = getLogger('SkillSources')

const SOURCES_FILE = 'store-sources.json'

export const OFFICIAL_SOURCE_ID = 'official'

/**
 * 官方源（内存常量，不落盘）
 * @param {string} [url]  覆盖官方 registry URL（createSkillHost 的 registryUrl 参数）
 */
export function getOfficialSource(url) {
  return {
    id: OFFICIAL_SOURCE_ID,
    name: '官方',
    url: url || DEFAULT_REGISTRY_URL,
    enabled: true,
    official: true
  }
}

/** 源配置文件路径：projectsDir 的父目录下 store-sources.json */
export function sourcesFilePath(projectsDir) {
  return path.join(path.dirname(projectsDir), SOURCES_FILE)
}

// ── 文件读写 ──────────────────────────────────────────────────────────────────

async function readStored(projectsDir) {
  try {
    const raw = await fs.readFile(sourcesFilePath(projectsDir), 'utf-8')
    const data = JSON.parse(raw)
    if (!Array.isArray(data.sources)) return { version: 1, sources: [] }
    // 兜底：过滤掉与官方源冲突的脏数据
    data.sources = data.sources.filter(s => s && s.id && s.id !== OFFICIAL_SOURCE_ID)
    return data
  } catch (err) {
    if (err.code === 'ENOENT') return { version: 1, sources: [] }
    throw err
  }
}

async function writeStored(projectsDir, data) {
  const file = sourcesFilePath(projectsDir)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

// ── 源管理 ────────────────────────────────────────────────────────────────────

/**
 * 列出所有商店源（官方源恒在首位）
 * @param {string} projectsDir
 * @param {object} [opts]
 * @param {string} [opts.officialUrl]  覆盖官方源 URL
 * @returns {Promise<Array<{ id, name, url, enabled, official?, addedAt? }>>}
 */
export async function listSources(projectsDir, { officialUrl } = {}) {
  const stored = await readStored(projectsDir)
  return [getOfficialSource(officialUrl), ...stored.sources]
}

/**
 * 添加第三方商店源
 * 校验：URL 必须为 http/https；不得与已有源重复；试拉一次验证 registry 格式
 *
 * @param {string} projectsDir
 * @param {object} opts
 * @param {string} opts.name  源显示名称
 * @param {string} opts.url   registry JSON 地址
 * @returns {Promise<{ id, name, url, enabled, addedAt }>}
 */
export async function addSource(projectsDir, { name, url } = {}) {
  const trimmedName = String(name || '').trim()
  const trimmedUrl = String(url || '').trim()
  if (!trimmedName) throw new Error('源名称不能为空')

  let parsed
  try {
    parsed = new URL(trimmedUrl)
  } catch {
    throw new Error(`无效的 URL: ${trimmedUrl}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 http/https 协议的商店源')
  }

  const sources = await listSources(projectsDir)
  if (sources.some(s => s.url === trimmedUrl)) {
    throw new Error('该 URL 已存在于商店源列表')
  }

  // 试拉一次验证 registry 格式（fetchRemoteRegistry 内部校验 subApps 数组）
  await fetchRemoteRegistry({ registryUrl: trimmedUrl })

  const entry = {
    id: randomUUID(),
    name: trimmedName,
    url: trimmedUrl,
    enabled: true,
    addedAt: new Date().toISOString()
  }

  const stored = await readStored(projectsDir)
  stored.sources.push(entry)
  await writeStored(projectsDir, stored)
  logger.info(`已添加商店源: ${trimmedName} (${trimmedUrl})`)
  return entry
}

/**
 * 删除第三方商店源（官方源不可删）
 * @param {string} projectsDir
 * @param {string} id
 */
export async function removeSource(projectsDir, id) {
  if (id === OFFICIAL_SOURCE_ID) throw new Error('官方源不可删除')

  const stored = await readStored(projectsDir)
  const idx = stored.sources.findIndex(s => s.id === id)
  if (idx === -1) throw new Error(`未找到商店源: ${id}`)

  const [removed] = stored.sources.splice(idx, 1)
  await writeStored(projectsDir, stored)
  logger.info(`已删除商店源: ${removed.name} (${removed.url})`)
  return removed
}

/**
 * 启用/禁用第三方商店源（官方源不可禁用）
 * @param {string} projectsDir
 * @param {string} id
 * @param {boolean} enabled
 */
export async function setSourceEnabled(projectsDir, id, enabled) {
  if (id === OFFICIAL_SOURCE_ID) throw new Error('官方源不可禁用')

  const stored = await readStored(projectsDir)
  const entry = stored.sources.find(s => s.id === id)
  if (!entry) throw new Error(`未找到商店源: ${id}`)

  entry.enabled = !!enabled
  await writeStored(projectsDir, stored)
  logger.info(`商店源 ${entry.name} 已${entry.enabled ? '启用' : '禁用'}`)
  return entry
}
