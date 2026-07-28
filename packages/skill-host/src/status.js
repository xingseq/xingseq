/**
 * skill-host/status.js
 * 子应用状态查询：已安装/可用/更新检测
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getLogger } from '@xingseq/shared-utils/logger'
import { fetchRemoteRegistry, fetchRemoteManifest } from './registry.js'

const logger = getLogger('SkillStatus')

const MANIFEST_FILE = 'sub-app-manifest.json'

// ── 状态枚举 ──────────────────────────────────────────────────────────────────

export const STATUS = {
  INSTALLED: 'installed',     // 已安装且正常
  AVAILABLE: 'available',     // 仅远程可用（未安装）
  UPDATE_AVAILABLE: 'update', // 已安装但有更新
  ERROR: 'error'              // 已安装但异常（如 manifest 损坏）
}

// ── 本地已安装列表 ────────────────────────────────────────────────────────────

/**
 * 列出已安装的子应用
 *
 * @param {string} projectsDir
 * @returns {Promise<Array<{ name, displayName, version, status, rootPath }>>}
 */
export async function listInstalled(projectsDir) {
  const results = []

  let entries
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const manifestPath = path.join(projectsDir, entry.name, MANIFEST_FILE)
    try {
      const raw = await fs.readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(raw)
      results.push({
        name: manifest.name || entry.name,
        displayName: manifest.displayName || manifest.name || entry.name,
        version: manifest.version || '0.0.0',
        description: manifest.description || '',
        status: STATUS.INSTALLED,
        rootPath: path.join(projectsDir, entry.name)
      })
    } catch (err) {
      if (err.code === 'ENOENT') continue
      // manifest 损坏
      results.push({
        name: entry.name,
        displayName: entry.name,
        version: 'unknown',
        description: '',
        status: STATUS.ERROR,
        rootPath: path.join(projectsDir, entry.name),
        error: err.message
      })
    }
  }

  return results
}

// ── 可用列表（合并远程+本地状态）───────────────────────────────────────────────

/**
 * 列出所有可用子应用（合并远程注册中心与本地状态）
 *
 * @param {object} opts
 * @param {string} opts.projectsDir
 * @param {function} [opts.getRegistry]  获取合并后注册表的函数（由 index.js 注入，避免重复拉取）
 * @param {object} [opts.registryOpts]   兼容旧签名：未注入 getRegistry 时直连 fetchRemoteRegistry
 * @returns {Promise<{ apps: Array<{ name, displayName, repo, sourceId?, sourceName?, localVersion?, status }>, sourceErrors: Array }>}
 */
export async function listAvailable({ projectsDir, getRegistry, registryOpts = {} } = {}) {
  // 并行拉取远程注册中心和本地列表
  const [remoteData, installed] = await Promise.all([
    getRegistry ? getRegistry() : fetchRemoteRegistry(registryOpts),
    listInstalled(projectsDir)
  ])

  const installedMap = new Map(installed.map(i => [i.name, i]))
  const results = []

  for (const entry of remoteData.subApps) {
    const local = installedMap.get(entry.name)

    if (local) {
      results.push({
        name: entry.name,
        displayName: local.displayName,
        repo: entry.repo,
        branch: entry.branch,
        sourceId: entry.sourceId,
        sourceName: entry.sourceName,
        localVersion: local.version,
        status: local.status === STATUS.ERROR ? STATUS.ERROR : STATUS.INSTALLED
      })
    } else {
      results.push({
        name: entry.name,
        repo: entry.repo,
        branch: entry.branch,
        sourceId: entry.sourceId,
        sourceName: entry.sourceName,
        status: STATUS.AVAILABLE
      })
    }
  }

  return { apps: results, sourceErrors: remoteData.sourceErrors || [] }
}

// ── 更新检测 ──────────────────────────────────────────────────────────────────

/**
 * 检查哪些已安装的子应用有更新
 * 通过比较本地 version 与远程 manifest version
 *
 * @param {object} opts
 * @param {string} opts.projectsDir
 * @param {function} [opts.getRegistry]  获取合并后注册表的函数（由 index.js 注入）
 * @param {object} [opts.registryOpts]   兼容旧签名
 * @returns {Promise<Array<{ name, localVersion, remoteVersion }>>}
 */
export async function checkUpdates({ projectsDir, getRegistry, registryOpts = {} } = {}) {
  const [remoteData, installed] = await Promise.all([
    getRegistry ? getRegistry() : fetchRemoteRegistry(registryOpts),
    listInstalled(projectsDir)
  ])

  if (installed.length === 0) return []

  const installedMap = new Map(installed.map(i => [i.name, i]))
  const updates = []

  // 对已安装的子应用，逐个检查远程版本
  const remoteEntries = remoteData.subApps.filter(e => installedMap.has(e.name))

  for (const entry of remoteEntries) {
    try {
      const remoteManifest = await fetchRemoteManifest(entry)
      const local = installedMap.get(entry.name)

      if (remoteManifest.version && remoteManifest.version !== local.version) {
        updates.push({
          name: entry.name,
          localVersion: local.version,
          remoteVersion: remoteManifest.version,
          entry
        })
      }
    } catch (err) {
      logger.debug(`检查更新失败 (${entry.name}): ${err.message}`)
    }
  }

  if (updates.length > 0) {
    logger.info(`发现 ${updates.length} 个可更新: ${updates.map(u => u.name).join(', ')}`)
  }

  return updates
}
