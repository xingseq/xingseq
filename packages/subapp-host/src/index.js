/**
 * @xingseq/subapp-host
 * L2 领域：子应用注册 / 进程 / CLI / UI / 记忆
 *
 * 核心职责：
 *   1. 扫描 projectsDir 下的 sub-app-manifest.json，自动发现子应用
 *   2. 维护注册表（Map），提供 list / get / has 查询
 *   3. 通过 CLI 执行子应用命令，返回 JSON 结构化结果
 *
 * 用法：
 *   const host = await createSubAppHost({ projectsDir })
 *   host.list()                     // 所有子应用摘要
 *   host.get('ai-draw')             // 完整 manifest
 *   await host.execute('ai-draw', 'generate', { prompt: '...' })
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { getLogger } from '@xingseq/shared-utils/logger'

const logger = getLogger('SubAppHost')

// ── 默认配置 ──────────────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 30_000
const MANIFEST_FILE = 'sub-app-manifest.json'

// ── 发现 ──────────────────────────────────────────────────────────────────────

/**
 * 扫描 projectsDir，返回所有含 sub-app-manifest.json 的子应用 manifest
 * @param {string} projectsDir
 * @returns {Promise<Array<{ manifest: object, rootPath: string }>>}
 */
export async function discoverSubApps(projectsDir) {
  const results = []

  let entries
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.debug(`项目目录不存在，跳过: ${projectsDir}`)
      return []
    }
    throw err
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const manifestPath = path.join(projectsDir, entry.name, MANIFEST_FILE)
    try {
      const raw = await fs.readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(raw)
      if (!manifest.name) {
        logger.warn(`跳过 ${entry.name}: manifest 缺少 name 字段`)
        continue
      }
      results.push({ manifest, rootPath: path.join(projectsDir, entry.name) })
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.debug(`跳过 ${entry.name}: ${err.message}`)
      }
    }
  }

  return results
}

// ── CLI 参数构建 ──────────────────────────────────────────────────────────────

/**
 * 将 args 对象转为 CLI 参数数组
 * { prompt: 'hello', model: 'rapid' } → ['--prompt', 'hello', '--model', 'rapid']
 * 位置参数（不以 -- 开头的 key）直接传值
 *
 * @param {object} args
 * @param {string[]} declaredArgs  manifest 中声明的参数列表（如 ['--prompt', '--model']）
 * @returns {string[]}
 */
function buildCliArgs(args, declaredArgs = []) {
  if (!args || typeof args !== 'object') return []

  const cliArgs = []
  const declaredSet = new Set(declaredArgs)

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue

    // 判断是位置参数还是选项参数
    const isPositional = declaredSet.has(key) && !key.startsWith('--')
    if (isPositional) {
      cliArgs.push(String(value))
    } else {
      const flag = key.startsWith('-') ? key : `--${key}`
      if (typeof value === 'boolean') {
        if (value) cliArgs.push(flag)
      } else {
        cliArgs.push(flag, String(value))
      }
    }
  }

  return cliArgs
}

/**
 * 将 command 名转为 CLI 子命令参数
 * 支持 "config:set" → ["config", "set"]，"generate" → ["generate"]
 */
function commandToArgs(command) {
  return command.replace(/:/g, ' ').split(/\s+/).filter(Boolean)
}

// ── CLI 执行 ──────────────────────────────────────────────────────────────────

/**
 * 执行子应用 CLI 命令
 *
 * @param {object} appEntry  { manifest, rootPath }
 * @param {string} command   命令名（如 'generate', 'config:show'）
 * @param {object} [args={}] 参数对象
 * @param {object} [opts]
 * @param {number} [opts.timeout]  超时毫秒数
 * @returns {Promise<object>} { success, stdout, parsed? }
 */
export function executeCommand(appEntry, command, args = {}, opts = {}) {
  const { manifest, rootPath } = appEntry
  const cli = manifest.cli

  if (!cli?.enabled) {
    return Promise.resolve({ success: false, error: `${manifest.name} 未启用 CLI` })
  }

  const binPath = path.resolve(rootPath, cli.bin)
  const declaredArgs = cli.commands?.[command]?.args || []
  const timeout = opts.timeout || DEFAULT_TIMEOUT_MS

  // 构建完整命令参数
  let spawnArgs = []

  if (cli.style === 'subcommand') {
    // subcommand 风格：bin <command> [args...]
    spawnArgs = [...commandToArgs(command), ...buildCliArgs(args, declaredArgs)]
  } else {
    // direct 风格：bin [args...]  command 作为第一个位置参数或忽略
    spawnArgs = [...buildCliArgs(args, declaredArgs)]
  }

  logger.debug(`执行: ${binPath} ${spawnArgs.join(' ')}  (cwd: ${rootPath})`)

  return new Promise((resolve) => {
    const child = spawn('node', [binPath, ...spawnArgs], {
      cwd: rootPath,
      timeout,
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    child.on('error', (err) => {
      resolve({ success: false, error: `启动失败: ${err.message}` })
    })

    child.on('close', (code) => {
      // 尝试解析 JSON 输出
      let parsed = null
      try {
        parsed = JSON.parse(stdout.trim())
      } catch {
        // 非 JSON 输出，保留原始文本
      }

      if (code === 0 && parsed) {
        resolve(parsed)
      } else if (code === 0) {
        resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim() || undefined })
      } else {
        resolve({
          success: false,
          exitCode: code,
          error: parsed?.error || stderr.trim() || stdout.trim() || `退出码 ${code}`
        })
      }
    })
  })
}

// ── 工厂 ──────────────────────────────────────────────────────────────────────

/**
 * 创建子应用宿主实例
 *
 * @param {object} opts
 * @param {string} opts.projectsDir  项目根目录（含子应用文件夹）
 * @returns {Promise<SubAppHost>}
 */
export async function createSubAppHost({ projectsDir } = {}) {
  if (!projectsDir) {
    throw new Error('createSubAppHost: projectsDir 必填')
  }

  /** @type {Map<string, { manifest: object, rootPath: string }>} */
  const registry = new Map()

  // 发现并注册
  const discovered = await discoverSubApps(projectsDir)
  for (const entry of discovered) {
    registry.set(entry.manifest.name, entry)
    logger.debug(`已注册子应用: ${entry.manifest.name} (${entry.rootPath})`)
  }

  if (discovered.length > 0) {
    logger.info(`子应用宿主已加载 ${discovered.length} 个子应用: ${discovered.map(d => d.manifest.name).join(', ')}`)
  }

  return {
    /** 列出所有子应用摘要 */
    list() {
      return Array.from(registry.values()).map(({ manifest }) => ({
        name: manifest.name,
        displayName: manifest.displayName || manifest.name,
        description: manifest.description || '',
        version: manifest.version || '',
        cli: manifest.cli?.enabled ?? false,
        commands: manifest.cli?.commands
          ? Object.entries(manifest.cli.commands).map(([cmd, def]) => ({
              name: cmd,
              description: def.description || '',
              args: def.args || []
            }))
          : [],
        ui: manifest.ui?.enabled ? { port: manifest.ui.port, routes: manifest.ui.routes } : null
      }))
    },

    /** 获取单个子应用完整信息 */
    get(name) {
      const entry = registry.get(name)
      if (!entry) return null
      return { ...entry.manifest, rootPath: entry.rootPath }
    },

    /** 判断子应用是否已注册 */
    has(name) {
      return registry.has(name)
    },

    /** 执行子应用 CLI 命令 */
    execute(name, command, args = {}, opts = {}) {
      const entry = registry.get(name)
      if (!entry) {
        return Promise.resolve({ success: false, error: `未找到子应用: ${name}` })
      }
      return executeCommand(entry, command, args, opts)
    },

    /** 已注册数量 */
    get size() {
      return registry.size
    }
  }
}

// ── Handlers 工厂（供 chat-core 注册到 tool-registry）─────────────────────────

export { createSubAppHandlers } from './handlers.js'
/**
 * @xingseq/subapp-host
 * L2 领域：子应用注册 / 进程 / CLI / UI / 记忆
 *
 * 阶段 0 脚手架占位入口，按拆分计划在对应阶段迁入实际实现。
 */
export const __scaffold__ = true
