/**
 * chat-app workspace（工作区）管理
 *
 * 职责：
 *   - 决定每次启动的 workspace 路径（chat-app 自带"默认 workspace"）
 *   - 首次创建时写入欢迎文件，让 list_dir / read_file 立即有内容可读
 *   - 列出已有 workspaces（为未来 workspace-app 接管做铺垫）
 *
 * 数据布局：
 *   <userData>/workspaces/<name>/
 *     ├── files/        AI 通过 list_dir / read_file 能看到的目录（只读语义）
 *     └── memory/       这个 workspace 独立的对话历史（由 workspaceStore 管理）
 *
 * 解析优先级（resolveWorkspace）：
 *   1. opts.workspace                        显式传入（name 或 绝对路径）
 *   2. process.env.CHAT_APP_WORKSPACE        环境变量（同上）
 *   3. 'default'                             默认 workspace 名
 *
 * 注意：
 *   - CLI 暂不接受任意绝对路径作为 workspace（避免越权 / 命名混乱）；
 *     当 opts.workspace 看起来是路径时，统一拒绝并提示用 name。
 *     等 workspace-app 真正出现时再放开。
 */

import path from 'node:path'
import { promises as fs, existsSync } from 'node:fs'
import { getSharedEnv } from '@xingseq/shared-utils/env'
import { getLogger } from '@xingseq/shared-utils/logger'

const logger = getLogger('Workspace')

export const DEFAULT_WORKSPACE_NAME = 'default'

const WELCOME_README = `# chat-app 默认工作区

这是 chat-app 在你电脑上的默认工作区目录。

AI 在对话中调用以下工具时，路径全部相对于这个目录解析（且禁止越权访问外部）：

  - list_dir(path)
  - read_file(path)

## 怎么用

把任何想让 AI 帮你阅读、引用、总结的内容放进这个目录：
  - 笔记、文档、代码片段
  - 临时草稿
  - 工作上下文

然后在 chat-app 里直接问：

  > 列一下我的工作区有什么文件
  > 帮我读 README.md 并总结一下
  > NOTES.md 里我都记了什么

## 想换工作区？

  - 启动时加 \`--workspace <name>\` 切换或新建
  - 或设置环境变量 \`CHAT_APP_WORKSPACE=<name>\`
  - 每个 workspace 拥有独立的对话历史和文件目录，互不干扰

## 安全约束

  - 只读：chat-app 自带的工具不会写入或删除文件
  - 越权防护：\`..\` 或绝对路径会被直接拒绝
  - 单文件读取上限 64KB
`

const WELCOME_NOTES = `# 我的笔记

这是一个示例笔记文件。你可以替换成自己的内容，或者在对话里让 AI 帮你读这个文件来验证工具链路是否跑通。

---

试一下：

  > 帮我读一下 NOTES.md
  > NOTES.md 里讲了什么？
`

/**
 * 取 userData 根路径（必须先 setSharedEnv）
 */
function requireUserData() {
  const env = getSharedEnv()
  const app = typeof env.getApp === 'function' ? env.getApp() : null
  if (!app || typeof app.getPath !== 'function') {
    throw new Error('resolveWorkspace: getApp 未注入，请先 setSharedEnv({ getApp })')
  }
  return app.getPath('userData')
}

/**
 * 校验 workspace name 合法性
 *   - 不接受 '/' '\' '..' 起始的内容（避免误传路径）
 *   - 仅允许字母/数字/下划线/连字符/点（不含 '..'）
 */
function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error(`workspace 名不能为空`)
  }
  const n = name.trim()
  if (n.includes('/') || n.includes('\\') || n.startsWith('.') && n !== '.' || n.includes('..')) {
    throw new Error(`workspace 名非法："${name}"。仅支持字母/数字/_/-/.，且不能以 . 开头或包含 ..（暂不支持绝对路径，未来由 workspace-app 提供）`)
  }
  if (!/^[A-Za-z0-9_\-.]+$/.test(n)) {
    throw new Error(`workspace 名非法："${name}"。仅支持字母/数字/_/-/.`)
  }
  return n
}

/**
 * 解析 workspace 描述对象（不会创建目录）
 *
 * @param {object} opts
 * @param {string} [opts.workspace] - workspace 名（不传则用 env，再 fallback 到 default）
 * @returns {{ name: string, root: string, filesDir: string, memoryDir: string }}
 */
export function resolveWorkspace(opts = {}) {
  const raw = opts.workspace
    || process.env.CHAT_APP_WORKSPACE
    || DEFAULT_WORKSPACE_NAME
  const name = validateName(raw)
  const userData = requireUserData()
  const root = path.join(userData, 'workspaces', name)
  return {
    name,
    root,
    filesDir: path.join(root, 'files'),
    memoryDir: path.join(root, 'memory')
  }
}

/**
 * 确保 workspace 目录存在（首次创建会写入欢迎文件）
 *
 * @param {{ name, root, filesDir, memoryDir }} ws
 * @returns {Promise<{ created: boolean }>}  created=true 表示首次创建
 */
export async function ensureWorkspace(ws) {
  const exists = existsSync(ws.root)
  await fs.mkdir(ws.filesDir, { recursive: true })
  await fs.mkdir(ws.memoryDir, { recursive: true })
  await fs.mkdir(path.join(ws.memoryDir, 'conversations'), { recursive: true })

  if (!exists) {
    // 首次创建，写入欢迎文件
    await fs.writeFile(path.join(ws.filesDir, 'README.md'), WELCOME_README, 'utf-8')
    await fs.writeFile(path.join(ws.filesDir, 'NOTES.md'), WELCOME_NOTES, 'utf-8')
    logger.info(`workspace [${ws.name}] 首次创建于 ${ws.root}`)
    return { created: true }
  }
  return { created: false }
}

/**
 * 列出所有已创建的 workspaces
 *
 * @returns {Promise<Array<{ name, root, filesDir, memoryDir }>>}
 */
export async function listWorkspaces() {
  const userData = requireUserData()
  const base = path.join(userData, 'workspaces')
  if (!existsSync(base)) return []
  const entries = await fs.readdir(base, { withFileTypes: true })
  return entries
    .filter(e => e.isDirectory())
    .map(e => {
      const root = path.join(base, e.name)
      return {
        name: e.name,
        root,
        filesDir: path.join(root, 'files'),
        memoryDir: path.join(root, 'memory')
      }
    })
}
