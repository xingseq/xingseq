/**
 * skill-host/registry.js
 * 远程注册中心：从 xingseq-agent-hub 拉取可用子应用列表
 */

import { getLogger } from '@xingseq/shared-utils/logger'

const logger = getLogger('SkillRegistry')

// ── 默认配置 ──────────────────────────────────────────────────────────────────
export const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/xingseq/xingseq-agent-hub/main/sub-apps-registry.json'
const DEFAULT_FETCH_TIMEOUT = 15_000

/**
 * 从远程 xingseq-agent-hub 拉取 sub-apps-registry.json
 *
 * @param {object} [opts]
 * @param {string} [opts.registryUrl]  注册中心 URL
 * @param {number} [opts.timeout]      超时毫秒
 * @returns {Promise<{ version: number, subApps: Array<RegistryEntry> }>}
 *
 * @typedef {object} RegistryEntry
 * @property {string} name          子应用名
 * @property {string} repo          仓库地址（GitHub/Gitea 等）
 * @property {string} branch        默认分支
 * @property {string} manifestPath  manifest 文件在仓库中的路径
 * @property {string} [source]      来源类型（github | gitea，缺省按 github 处理）
 * @property {string} [rawUrlTemplate]  自定义 raw manifest URL 模板（优先于 source），
 *                                      支持占位符 {repo} {branch} {manifestPath}
 */
export async function fetchRemoteRegistry({
  registryUrl = DEFAULT_REGISTRY_URL,
  timeout = DEFAULT_FETCH_TIMEOUT
} = {}) {
  logger.debug(`拉取远程注册中心: ${registryUrl}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const resp = await fetch(registryUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'xingseq-skill-host/0.1.0' }
    })

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
    }

    const data = await resp.json()
    if (!data.subApps || !Array.isArray(data.subApps)) {
      throw new Error('无效的注册中心数据格式：缺少 subApps 数组')
    }

    logger.info(`已获取 ${data.subApps.length} 个可用子应用`)
    return data
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`拉取注册中心超时 (${timeout}ms)`)
    }
    // undici 网络层错误只抛 "fetch failed"，真实原因（ECONNREFUSED/EHOSTUNREACH 等）在 cause 里
    const cause = err.cause ? ` (${err.cause.code || err.cause.message})` : ''
    throw new Error(`拉取注册中心失败: ${err.message}${cause}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 并行拉取多个商店源并合并
 *
 * 合并规则：按源顺序遍历（官方源恒在首位），同名 name 先到先得
 * → 官方源优先，第三方同名条目丢弃。单源失败不影响其它源。
 *
 * @param {Array<{ id, name, url, enabled }>} sources  商店源列表
 * @param {object} [opts]
 * @param {number} [opts.timeout]
 * @returns {Promise<{ subApps: Array<RegistryEntry & { sourceId, sourceName }>, sourceErrors: Array<{ sourceId, sourceName, error }> }>}
 */
export async function fetchAllRegistries(sources, { timeout = DEFAULT_FETCH_TIMEOUT } = {}) {
  const enabled = (sources || []).filter(s => s && s.enabled !== false)
  const settled = await Promise.allSettled(
    enabled.map(s => fetchRemoteRegistry({ registryUrl: s.url, timeout }))
  )

  const seen = new Set()
  const subApps = []
  const sourceErrors = []

  settled.forEach((result, i) => {
    const src = enabled[i]
    if (result.status === 'rejected') {
      const message = result.reason?.message || String(result.reason)
      logger.warn(`商店源不可用 (${src.name}): ${message}`)
      sourceErrors.push({ sourceId: src.id, sourceName: src.name, error: message })
      return
    }
    for (const entry of result.value.subApps) {
      if (!entry || !entry.name) continue
      if (seen.has(entry.name)) {
        logger.debug(`同名条目丢弃 (${entry.name} @ ${src.name})：前序源优先`)
        continue
      }
      seen.add(entry.name)
      subApps.push({ ...entry, sourceId: src.id, sourceName: src.name })
    }
  })

  return { subApps, sourceErrors }
}

/**
 * 解析注册中心条目对应的 raw manifest URL
 *
 * 优先级：rawUrlTemplate（源作者自定义模板）> source: 'gitea' 约定格式 > GitHub 默认改写。
 * Gitea raw 路径约定：{repo}/raw/branch/{branch}/{manifestPath}
 *
 * @param {RegistryEntry} entry
 * @returns {string}
 */
export function resolveManifestRawUrl(entry) {
  const repoUrl = (entry.repo || '').replace(/\.git$/, '')
  const branch = entry.branch || 'main'
  const manifestPath = entry.manifestPath || 'sub-app-manifest.json'

  if (entry.rawUrlTemplate) {
    return entry.rawUrlTemplate
      .replaceAll('{repo}', repoUrl)
      .replaceAll('{branch}', branch)
      .replaceAll('{manifestPath}', manifestPath)
  }

  if (entry.source === 'gitea') {
    return `${repoUrl}/raw/branch/${branch}/${manifestPath}`
  }

  // 默认：GitHub 仓库改写为 raw.githubusercontent.com
  return repoUrl.replace('github.com', 'raw.githubusercontent.com') + `/${branch}/${manifestPath}`
}

/**
 * 获取单个子应用的远程 manifest
 *
 * @param {RegistryEntry} entry  注册中心条目
 * @param {object} [opts]
 * @param {number} [opts.timeout]
 * @returns {Promise<object>} 远程 manifest 内容
 */
export async function fetchRemoteManifest(entry, { timeout = DEFAULT_FETCH_TIMEOUT } = {}) {
  const rawUrl = resolveManifestRawUrl(entry)

  logger.debug(`拉取远程 manifest: ${rawUrl}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const resp = await fetch(rawUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'xingseq-skill-host/0.1.0' }
    })

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
    }

    return await resp.json()
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`拉取 manifest 超时 (${timeout}ms): ${entry.name}`)
    }
    throw new Error(`拉取 manifest 失败 (${entry.name}): ${err.message}`)
  } finally {
    clearTimeout(timer)
  }
}
