/**
 * toolLoader - 工具插件自动发现与加载
 *
 * 扫描约定目录（默认 ~/.xingseq/tools/），动态 import 插件模块并注册到 ToolRegistry。
 *
 * 插件接口（每个 .js 文件或含 index.js 的目录）：
 *   export const name = 'plugin-name'       // 注册组名（必填）
 *   export const displayName = '显示名称'    // 可选，默认 = name
 *   export const tools = [...]              // OpenAI Function Calling 定义数组（必填）
 *   export function createHandlers(context) // 工厂函数（必填）
 *
 * context 由 loader 注入：
 *   { workspace, toolDirs, logger }
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { getLogger } from '@xingseq/shared-utils/logger'

const logger = getLogger('ToolLoader')

/**
 * 扫描目录，返回插件入口路径列表
 *
 * 支持两种形态：
 *   - ~/.xingseq/tools/foo.js         → 单文件插件
 *   - ~/.xingseq/tools/bar/index.js   → 目录插件
 *
 * @param {string} dir
 * @returns {Promise<string[]>} 插件入口绝对路径列表
 */
export async function discoverTools(dir) {
  const plugins = []

  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.debug(`工具目录不存在，跳过: ${dir}`)
      return []
    }
    throw err
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      plugins.push(path.join(dir, entry.name))
    } else if (entry.isDirectory()) {
      const indexPath = path.join(dir, entry.name, 'index.js')
      try {
        await fs.access(indexPath)
        plugins.push(indexPath)
      } catch {
        logger.debug(`跳过目录 ${entry.name}（无 index.js）`)
      }
    }
  }

  return plugins.sort()
}

/**
 * 动态 import 单个插件并校验接口
 *
 * @param {string} pluginPath 插件入口绝对路径
 * @param {object} context    注入给 createHandlers 的上下文
 * @returns {Promise<{ name, displayName, tools, handlers } | null>}
 */
export async function loadPlugin(pluginPath, context = {}) {
  const label = path.basename(path.dirname(pluginPath)) === 'tools'
    ? path.basename(pluginPath)
    : `${path.basename(path.dirname(pluginPath))}/${path.basename(pluginPath)}`

  let mod
  try {
    // 动态 import 需要 file:// URL（跨平台兼容）
    const url = pathToFileURL(pluginPath).href
    mod = await import(url)
  } catch (err) {
    logger.warn(`插件加载失败 [${label}]: ${err.message}`)
    return null
  }

  // 校验必填字段
  const { name, tools, createHandlers } = mod
  if (!name || typeof name !== 'string') {
    logger.warn(`插件跳过 [${label}]: 缺少 export const name`)
    return null
  }
  if (!Array.isArray(tools) || tools.length === 0) {
    logger.warn(`插件跳过 [${name}]: tools 必须为非空数组`)
    return null
  }
  if (typeof createHandlers !== 'function') {
    logger.warn(`插件跳过 [${name}]: 缺少 export function createHandlers`)
    return null
  }

  // 调用 createHandlers 获取 handlers
  let handlers
  try {
    handlers = createHandlers(context)
  } catch (err) {
    logger.warn(`插件跳过 [${name}]: createHandlers 执行失败: ${err.message}`)
    return null
  }

  if (!handlers || typeof handlers !== 'object') {
    logger.warn(`插件跳过 [${name}]: createHandlers 必须返回对象`)
    return null
  }

  const displayName = mod.displayName || name
  logger.debug(`插件已加载: ${name} (${tools.length} 个工具)`)

  return { name, displayName, tools, handlers }
}

/**
 * 扫描多个目录 → 加载插件 → 注册到 registry
 *
 * @param {object}   registry          ToolRegistry 实例
 * @param {object}   [opts]
 * @param {string[]} [opts.toolDirs]   插件目录列表
 * @param {object}   [opts.workspace]  当前 workspace（注入给插件 context）
 * @returns {Promise<{ loaded: string[], skipped: string[] }>}
 */
export async function loadExternalTools(registry, { toolDirs = [], workspace = null } = {}) {
  const loaded = []
  const skipped = []
  const defaultDir = path.join(os.homedir(), '.xingseq', 'tools')

  const dirs = toolDirs.length > 0 ? toolDirs : [defaultDir]
  const context = { workspace, toolDirs: dirs, logger }

  for (const dir of dirs) {
    const paths = await discoverTools(dir)

    for (const pluginPath of paths) {
      const result = await loadPlugin(pluginPath, context)

      if (!result) {
        skipped.push(pluginPath)
        continue
      }

      // 重复 name 检测
      if (registry.getGroup(result.name)) {
        logger.warn(`插件跳过 [${result.name}]: 组名已存在（内置工具或已加载插件）`)
        skipped.push(pluginPath)
        continue
      }

      registry.register(result.name, {
        displayName: result.displayName,
        tools: result.tools,
        handlers: result.handlers
      })
      loaded.push(result.name)
    }
  }

  if (loaded.length > 0) {
    logger.debug(`外部工具加载完成: ${loaded.length} 个插件, ${skipped.length} 个跳过`)
  }

  return { loaded, skipped }
}
