/**
 * @xingseq/skill-host
 * L2 领域：skill 下载 / 安装 / 状态 / 清理
 *
 * 核心职责：
 *   1. 从 xingseq-agent-hub 远程注册中心发现可用子应用
 *   2. 安装/卸载/更新子应用到本地 projectsDir
 *   3. 查询本地/远程子应用状态
 *
 * 用法：
 *   const host = createSkillHost({ projectsDir })
 *   const available = await host.listAvailable()      // 远程+本地合并列表
 *   await host.install('ai-draw', onProgress)         // 安装
 *   await host.uninstall('ai-draw')                   // 卸载
 *   await host.update('ai-draw', onProgress)          // 更新
 *   const updates = await host.checkUpdates()         // 更新检测
 */

import path from 'node:path'
import os from 'node:os'
import { getLogger } from '@xingseq/shared-utils/logger'
import { fetchAllRegistries, fetchRemoteManifest } from './registry.js'
import {
  listSources as listSourcesImpl,
  addSource as addSourceImpl,
  removeSource as removeSourceImpl,
  setSourceEnabled as setSourceEnabledImpl,
  getOfficialSource
} from './sources.js'
import { install, uninstall, update } from './installer.js'
import { listInstalled, listAvailable, checkUpdates, STATUS } from './status.js'

const logger = getLogger('SkillHost')

// ── 默认路径 ──────────────────────────────────────────────────────────────────
const DEFAULT_PROJECTS_DIR = path.join(
  os.homedir(), 'Library', 'Application Support', 'xingseq', 'projects'
)

// ── 工厂函数 ──────────────────────────────────────────────────────────────────

/**
 * 创建 SkillHost 实例
 *
 * @param {object} [opts]
 * @param {string} [opts.projectsDir]   本地项目目录
 * @param {string} [opts.registryUrl]   注册中心 URL（传入时视为覆盖官方源 URL 的单源模式）
 * @returns {SkillHost}
 *
 * @typedef {object} SkillHost
 * @property {function} listInstalled   列出本地已安装
 * @property {function} listAvailable   列出所有可用（远程+本地）
 * @property {function} checkUpdates    检查更新
 * @property {function} install         安装子应用
 * @property {function} uninstall       卸载子应用
 * @property {function} update          更新子应用
 * @property {function} fetchRegistry   拉取合并后的多源注册表
 * @property {function} listSources     列出商店源
 * @property {function} addSource       添加第三方商店源
 * @property {function} removeSource    删除第三方商店源
 * @property {function} setSourceEnabled 启用/禁用商店源
 * @property {string}   projectsDir     本地项目目录路径
 */
export function createSkillHost({
  projectsDir = DEFAULT_PROJECTS_DIR,
  registryUrl
} = {}) {
  logger.info(`SkillHost 初始化 (projectsDir: ${projectsDir})`)

  // 缓存合并后的多源注册表数据（减少重复请求）
  let _registryCache = null
  let _registryCacheTime = 0
  const CACHE_TTL = 5 * 60 * 1000  // 5 分钟缓存

  function invalidateRegistryCache() {
    _registryCache = null
    _registryCacheTime = 0
  }

  async function getSources() {
    // registryUrl 传入时视为单源模式：仅用覆盖 URL 的官方源（向后兼容）
    if (registryUrl) return [getOfficialSource(registryUrl)]
    return listSourcesImpl(projectsDir)
  }

  async function getRegistry(forceRefresh = false) {
    const now = Date.now()
    if (!forceRefresh && _registryCache && (now - _registryCacheTime) < CACHE_TTL) {
      return _registryCache
    }
    const sources = await getSources()
    _registryCache = await fetchAllRegistries(sources)
    _registryCacheTime = now
    return _registryCache
  }

  return {
    /** 本地项目目录路径 */
    projectsDir,

    /** 拉取合并后的多源注册表（带缓存） */
    async fetchRegistry(forceRefresh = false) {
      return getRegistry(forceRefresh)
    },

    // ── 商店源管理 ────────────────────────────────────────

    /** 列出商店源（官方源恒在首位） */
    async listSources() {
      return getSources()
    },

    /** 添加第三方商店源（校验 URL + 试拉验证） */
    async addSource({ name, url } = {}) {
      const entry = await addSourceImpl(projectsDir, { name, url })
      invalidateRegistryCache()
      return entry
    },

    /** 删除第三方商店源（官方源不可删） */
    async removeSource(id) {
      const removed = await removeSourceImpl(projectsDir, id)
      invalidateRegistryCache()
      return removed
    },

    /** 启用/禁用第三方商店源（官方源不可禁用） */
    async setSourceEnabled(id, enabled) {
      const entry = await setSourceEnabledImpl(projectsDir, id, enabled)
      invalidateRegistryCache()
      return entry
    },

    /** 列出本地已安装的子应用 */
    async listInstalled() {
      return listInstalled(projectsDir)
    },

    /** 列出所有可用子应用（合并远程与本地状态，含 sourceErrors） */
    async listAvailable({ forceRefresh = false } = {}) {
      // forceRefresh 时跳过 5 分钟 TTL 缓存（否则连 sourceErrors 也会被缓存，导致前端刷新无效）
      return listAvailable({ projectsDir, getRegistry: () => getRegistry(forceRefresh) })
    },

    /** 检查哪些已安装的子应用有更新 */
    async checkUpdates() {
      return checkUpdates({ projectsDir, getRegistry })
    },

    /**
     * 安装子应用
     * @param {string} name  子应用名
     * @param {function} [onProgress]  进度回调
     * @returns {Promise<{ success, name, error? }>}
     */
    async install(name, onProgress) {
      const registry = await getRegistry()
      const entry = registry.subApps.find(e => e.name === name)
      if (!entry) {
        return { success: false, name, error: `注册中心未找到: ${name}` }
      }
      return install({ entry, projectsDir, onProgress })
    },

    /**
     * 卸载子应用
     * @param {string} name
     * @param {function} [onProgress]
     */
    async uninstall(name, onProgress) {
      return uninstall({ name, projectsDir, onProgress })
    },

    /**
     * 更新子应用
     * @param {string} name
     * @param {function} [onProgress]
     */
    async update(name, onProgress) {
      const registry = await getRegistry()
      const entry = registry.subApps.find(e => e.name === name)
      if (!entry) {
        return { success: false, name, error: `注册中心未找到: ${name}` }
      }
      return update({ entry, projectsDir, onProgress })
    },

    /**
     * 获取单个远程子应用的 manifest
     * @param {string} name
     */
    async getRemoteManifest(name) {
      const registry = await getRegistry()
      const entry = registry.subApps.find(e => e.name === name)
      if (!entry) return null
      return fetchRemoteManifest(entry)
    }
  }
}

// ── 导出子模块 ────────────────────────────────────────────────────────────────
export { fetchRemoteRegistry, fetchAllRegistries, fetchRemoteManifest, resolveManifestRawUrl, DEFAULT_REGISTRY_URL } from './registry.js'
export {
  listSources, addSource, removeSource, setSourceEnabled,
  getOfficialSource, OFFICIAL_SOURCE_ID, sourcesFilePath
} from './sources.js'
export { install, uninstall, update } from './installer.js'
export { listInstalled, listAvailable, checkUpdates, STATUS } from './status.js'
/**
 * @xingseq/skill-host
 * L2 领域：skill 下载 / 安装 / 状态 / 清理
 *
 * 阶段 0 脚手架占位入口，按拆分计划在对应阶段迁入实际实现。
 */
export const __scaffold__ = true
