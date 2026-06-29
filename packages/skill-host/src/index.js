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
import { fetchRemoteRegistry, fetchRemoteManifest } from './registry.js'
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
 * @param {string} [opts.registryUrl]   注册中心 URL（覆盖默认）
 * @returns {SkillHost}
 *
 * @typedef {object} SkillHost
 * @property {function} listInstalled   列出本地已安装
 * @property {function} listAvailable   列出所有可用（远程+本地）
 * @property {function} checkUpdates    检查更新
 * @property {function} install         安装子应用
 * @property {function} uninstall       卸载子应用
 * @property {function} update          更新子应用
 * @property {function} fetchRegistry   拉取远程注册中心
 * @property {string}   projectsDir     本地项目目录路径
 */
export function createSkillHost({
  projectsDir = DEFAULT_PROJECTS_DIR,
  registryUrl
} = {}) {
  const registryOpts = registryUrl ? { registryUrl } : {}

  logger.info(`SkillHost 初始化 (projectsDir: ${projectsDir})`)

  // 缓存远程注册中心数据（减少重复请求）
  let _registryCache = null
  let _registryCacheTime = 0
  const CACHE_TTL = 5 * 60 * 1000  // 5 分钟缓存

  async function getRegistry(forceRefresh = false) {
    const now = Date.now()
    if (!forceRefresh && _registryCache && (now - _registryCacheTime) < CACHE_TTL) {
      return _registryCache
    }
    _registryCache = await fetchRemoteRegistry(registryOpts)
    _registryCacheTime = now
    return _registryCache
  }

  return {
    /** 本地项目目录路径 */
    projectsDir,

    /** 拉取远程注册中心（带缓存） */
    async fetchRegistry(forceRefresh = false) {
      return getRegistry(forceRefresh)
    },

    /** 列出本地已安装的子应用 */
    async listInstalled() {
      return listInstalled(projectsDir)
    },

    /** 列出所有可用子应用（合并远程与本地状态） */
    async listAvailable() {
      return listAvailable({ projectsDir, registryOpts })
    },

    /** 检查哪些已安装的子应用有更新 */
    async checkUpdates() {
      return checkUpdates({ projectsDir, registryOpts })
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
export { fetchRemoteRegistry, fetchRemoteManifest } from './registry.js'
export { install, uninstall, update } from './installer.js'
export { listInstalled, listAvailable, checkUpdates, STATUS } from './status.js'
/**
 * @xingseq/skill-host
 * L2 领域：skill 下载 / 安装 / 状态 / 清理
 *
 * 阶段 0 脚手架占位入口，按拆分计划在对应阶段迁入实际实现。
 */
export const __scaffold__ = true
