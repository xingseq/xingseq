/**
 * workspace-app 工作区解析（增强版）
 *
 * 与 chat-core 内置 workspace.js 的差异：
 *   - 支持挂载任意绝对路径作为工作区（chat-app 明确拒绝此能力，留给 workspace-app 提供）
 *   - 路径式挂载时，filesDir = 用户指定目录本身（AI 可读写该目录及子目录）
 *   - memoryDir 始终存于 ~/.xingseq/workspace-app/memory/<hash>/（按路径 hash 隔离）
 *
 * 解析优先级（resolveWorkspace）：
 *   1. opts.workspacePath                   绝对路径挂载
 *   2. opts.workspace                       名称式（同 chat-app）
 *   3. process.env.WORKSPACE_APP_PATH       环境变量（绝对路径）
 *   4. process.env.WORKSPACE_APP_WORKSPACE  环境变量（名称）
 *   5. 'default'                            默认 workspace
 *
 * 数据布局：
 *   名称式：~/.xingseq/workspace-app/workspaces/<name>/
 *     ├── files/        AI 可读写的目录
 *     └── memory/       对话历史
 *
 *   路径式：
 *     filesDir  = 用户指定的绝对路径（如 /path/to/project）
 *     memoryDir = ~/.xingseq/workspace-app/memory/<pathHash>/
 */

import path from 'node:path'
import { createHash } from 'node:crypto'
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import { getSharedEnv } from '@xingseq/shared-utils/env'

/**
 * 取 app data 根路径（通过 shared env 注入，与 server/cli 启动时的 setSharedEnv 对齐）
 * 回退到 ~/.xingseq/workspace-app
 */
function getAppDataRoot() {
  try {
    const env = getSharedEnv()
    const app = typeof env.getApp === 'function' ? env.getApp() : null
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData')
    }
  } catch { /* ignore */ }
  return path.join(os.homedir(), '.xingseq', 'workspace-app')
}

/**
 * 对绝对路径取 short hash（用于 memory 目录隔离）
 */
function pathHash(absPath) {
  return createHash('sha256').update(absPath).digest('hex').slice(0, 12)
}

/**
 * 校验 workspace name 合法性
 */
function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error(`workspace 名不能为空`)
  }
  const n = name.trim()
  if (n.includes('/') || n.includes('\\') || (n.startsWith('.') && n !== '.') || n.includes('..')) {
    throw new Error(
      `workspace 名非法："${name}"。仅支持字母/数字/_/-/.，且不能以 . 开头或包含 ..`
    )
  }
  if (!/^[A-Za-z0-9_\-.]+$/.test(n)) {
    throw new Error(`workspace 名非法："${name}"。仅支持字母/数字/_/-/.`)
  }
  return n
}

/**
 * 解析 workspace 描述对象
 *
 * @param {object} opts
 * @param {string} [opts.workspacePath]  - 绝对路径挂载（优先级最高）
 * @param {string} [opts.workspace]      - 名称式
 * @returns {{ name: string, root: string, filesDir: string, memoryDir: string, mounted: boolean }}
 */
export function resolveWorkspace(opts = {}) {
  // 优先级 1: 显式绝对路径
  const absPath = opts.workspacePath || process.env.WORKSPACE_APP_PATH
  if (absPath) {
    if (!path.isAbsolute(absPath)) {
      throw new Error(`workspace-path 必须是绝对路径，收到: "${absPath}"`)
    }
    const hash = pathHash(absPath)
    const displayName = path.basename(absPath)
    return {
      name: displayName,
      root: absPath,
      filesDir: absPath,
      memoryDir: path.join(getAppDataRoot(), 'memory', hash),
      mounted: true
    }
  }

  // 优先级 2: 名称式
  const raw = opts.workspace
    || process.env.WORKSPACE_APP_WORKSPACE
    || 'default'
  const name = validateName(raw)
  const root = path.join(getAppDataRoot(), 'workspaces', name)
  return {
    name,
    root,
    filesDir: path.join(root, 'files'),
    memoryDir: path.join(root, 'memory'),
    mounted: false
  }
}

/**
 * 确保 workspace 目录存在
 *
 * @param {{ name, root, filesDir, memoryDir, mounted }} ws
 * @returns {Promise<{ created: boolean }>}
 */
export async function ensureWorkspace(ws) {
  if (ws.mounted) {
    // 路径挂载模式：验证目录存在即可，不创建 files/
    if (!existsSync(ws.filesDir)) {
      throw new Error(
        `挂载的工作区目录不存在: "${ws.filesDir}"。请确认路径正确。`
      )
    }
    // memoryDir 始终确保存在
    await fs.mkdir(path.join(ws.memoryDir, 'conversations'), { recursive: true })
    return { created: false }
  }

  // 名称式：先检查 root 是否存在（必须在 mkdir 之前）
  const exists = existsSync(ws.root)

  // 确保目录结构
  await fs.mkdir(ws.filesDir, { recursive: true })
  await fs.mkdir(path.join(ws.memoryDir, 'conversations'), { recursive: true })

  if (!exists) {
    // 首次创建，写入欢迎文件
    await fs.writeFile(
      path.join(ws.filesDir, 'README.md'),
      WELCOME_README,
      'utf-8'
    )
    return { created: true }
  }
  return { created: false }
}

/**
 * 列出所有已创建的 workspaces（名称式 + 挂载记录）
 *
 * @returns {Promise<Array<{ name, root, filesDir, memoryDir, mounted }>>}
 */
export async function listWorkspaces() {
  const results = []

  // 名称式
  const wsBase = path.join(getAppDataRoot(), 'workspaces')
  if (existsSync(wsBase)) {
    const entries = await fs.readdir(wsBase, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const root = path.join(wsBase, e.name)
      results.push({
        name: e.name,
        root,
        filesDir: path.join(root, 'files'),
        memoryDir: path.join(root, 'memory'),
        mounted: false
      })
    }
  }

  // 挂载记录（通过 memory/ 目录反推）
  const memBase = path.join(getAppDataRoot(), 'memory')
  if (existsSync(memBase)) {
    const entries = await fs.readdir(memBase, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      // 尝试读取 meta.json 获取原始路径
      const metaPath = path.join(memBase, e.name, 'meta.json')
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'))
          if (meta.mountedPath && existsSync(meta.mountedPath)) {
            results.push({
              name: path.basename(meta.mountedPath),
              root: meta.mountedPath,
              filesDir: meta.mountedPath,
              memoryDir: path.join(memBase, e.name),
              mounted: true
            })
          }
        } catch { /* ignore corrupt meta */ }
      }
    }
  }

  return results
}

/**
 * 保存挂载元数据（供 listWorkspaces 反查）
 */
export async function saveMountMeta(ws) {
  if (!ws.mounted) return
  const metaPath = path.join(ws.memoryDir, 'meta.json')
  await fs.mkdir(ws.memoryDir, { recursive: true })
  await fs.writeFile(metaPath, JSON.stringify({
    mountedPath: ws.filesDir,
    name: ws.name,
    createdAt: new Date().toISOString()
  }, null, 2), 'utf-8')
}

const WELCOME_README = `# workspace-app 默认工作区

这是 workspace-app 的默认工作区目录。

AI 在对话中可以对这个目录执行读/写操作：

  - list_dir / read_file（读取）
  - set_file_content / replace_file_string / delete_file（写入）
  - execute_command（Shell 命令）

所有写操作和 Shell 命令都会触发安全确认弹窗（Web 模式下 30s 倒计时）。

## 怎么用

把任何想让 AI 帮你处理的项目文件放进这个目录，或使用 \`--workspace-path\` 直接挂载你的项目目录：

  workspace-app --workspace-path /path/to/your/project

## 安全约束

  - 沙箱：所有工具只能操作工作区目录及其子目录
  - 确认：写操作和 Shell 必须通过安全确认（CLI 自动放行，Web 需手动确认）
  - 越权防护：\`..\` 或工作区外的绝对路径会被直接拒绝
`
