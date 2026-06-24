/**
 * chat-app 安全模块（精简版）
 *
 * 与 develop 的 electron/tools/utils/security 保持思想一致，但 chat-app 没有 Electron / 配置中心，
 * 所以只保留最核心的部分：
 *   - 命令白名单（仅标准模式，不暴露 advanced/unrestricted）
 *   - 参数过滤（拒绝命令注入字符）
 *   - shell 元字符检测（沿用 develop 的 bash -c 兜底逻辑）
 *
 * 路径安全由 workspace.filesDir 自身约束（fsTools/shellTools 强制 cwd = filesDir，且禁越权），
 * 不再需要全局 SAFE_PATHS / BLOCKED_PATHS 体系。
 */

import path from 'node:path'

export const MAX_FILE_SIZE = 10 * 1024 * 1024              // 10MB（与 develop 一致）
export const MAX_COMMAND_TIMEOUT = 300_000                  // 最大 5 分钟
export const DEFAULT_COMMAND_TIMEOUT = 30_000               // 默认 30 秒

// 命令白名单 —— 等同 develop 标准模式
export const ALLOWED_COMMANDS = [
  // Node.js
  'npm', 'npx', 'yarn', 'pnpm', 'node',
  // VCS
  'git',
  // 构建
  'make', 'cmake',
  // Python
  'python', 'python3', 'pip', 'pip3', 'poetry',
  // 常用
  'ls', 'dir', 'pwd', 'echo', 'cat', 'grep', 'find', 'head', 'tail', 'wc', 'sort',
  // 系统信息
  'whoami', 'hostname', 'uname'
]

// shell 元字符检测：命中即整体走 bash -c "..."，跳过白名单和参数过滤
const SHELL_METACHARS = /(\|\||&&|[;|<>`$()])/

export function detectShellMeta(command, args = []) {
  const cmdStr = String(command || '')
  if (SHELL_METACHARS.test(cmdStr)) return true
  return Array.isArray(args) && args.some(a => typeof a === 'string' && SHELL_METACHARS.test(a))
}

/**
 * 验证命令是否在白名单内
 * @returns {string} 小写后的基础命令名
 */
export function validateCommand(command) {
  if (!command || typeof command !== 'string') {
    throw new Error('命令必填且必须为字符串')
  }
  const base = command.toLowerCase()
  if (!ALLOWED_COMMANDS.includes(base)) {
    throw new Error(`命令 "${command}" 不在白名单内。允许：${ALLOWED_COMMANDS.join(', ')}`)
  }
  return base
}

/**
 * 过滤危险参数（与 develop 一致：; ` $ ( ) < >；标准模式额外拒 | & 重定向）
 * @returns {string[]} 已过滤的参数（顺序保留）
 */
export function sanitizeCommandArgs(args = []) {
  if (!Array.isArray(args)) return []
  const dangerous = [';', '`', '$', '(', ')', '<', '>']
  return args.filter(arg => {
    if (typeof arg !== 'string') return false
    for (const ch of dangerous) {
      if (arg.includes(ch)) return false
    }
    if (arg.includes('|') || arg.includes('&')) return false
    return true
  })
}

/**
 * 把传入的相对/绝对路径解析为 workspace 内的安全绝对路径
 * 越权（含 ..、解析后跳出 cwd）即抛错
 */
export function resolveSafePath(cwd, relPath) {
  if (typeof relPath !== 'string') {
    throw new Error('路径必填')
  }
  const full = path.resolve(cwd, relPath)
  const rel = path.relative(cwd, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径越权：${relPath} 不在工作区内`)
  }
  return full
}
