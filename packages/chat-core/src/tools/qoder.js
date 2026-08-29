/**
 * chat-core Qoder CLI 工具组
 *
 * 工具：
 *   - qoder_task(task, project?, cwd?, max_turns?)  把编码/分析任务交给 Qoder CLI headless 执行
 *
 * 项目注册表（~/.xingseq/qoder-projects.json）：
 *   { "defaultProject": "xingseq",
 *     "projects": [{ "name": "xingseq", "path": "/abs/path", "description": "…" }] }
 *   - 项目清单注入工具 description，LLM 天然知道「项目名 → 路径」映射
 *   - path 参数支持项目名（"在 xx 项目里…"），多根白名单校验
 *   - 管理命令：node apps/mail-app/src/cli.mjs projects [list|add|remove|default]
 *
 * 执行方式：
 *   qodercli -p "<task>" -w <cwd> --permission-mode accept_edits \
 *            --output-format json --max-turns <n>
 *
 * 安全：
 *   - 权限锁定 accept_edits：文件编辑自动通过，危险 Shell 命令被 Qoder 拒绝
 *   - cwd 限制在「注册项目根 + monorepo 根」多根白名单内，禁止越界
 *   - qoder_task 在 DEFAULT_SENSITIVE_TOOLS 中；无 confirmation 的无人值守链路直接执行
 *
 * 二进制查找顺序（launchd 环境 PATH 不全，需要绝对路径 fallback）：
 *   1. opts.binPath
 *   2. 环境变量 QODER_CLI_BIN
 *   3. ~/.local/bin/qodercli（官方安装脚本默认位置）
 *   4. PATH 中的 qodercli
 */

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const MONOREPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const PROJECTS_CONFIG_PATH = path.join(os.homedir(), '.xingseq', 'qoder-projects.json')

/**
 * 读取用户注册的项目清单
 * path 不存在的项目会被忽略（避免 LLM 选中打不开的目录）
 */
export function loadQoderProjects() {
  let raw
  try {
    raw = fs.readFileSync(PROJECTS_CONFIG_PATH, 'utf8')
  } catch {
    return { defaultProject: null, projects: [] }
  }
  try {
    const cfg = JSON.parse(raw)
    const seen = new Set()
    const projects = []
    for (const p of (Array.isArray(cfg.projects) ? cfg.projects : [])) {
      if (!p || typeof p.name !== 'string' || typeof p.path !== 'string') continue
      const name = p.name.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      const abs = path.resolve(p.path)
      if (!fs.existsSync(abs)) continue
      projects.push({ name, path: abs, description: String(p.description || '') })
    }
    const defaultProject = projects.some(p => p.name === cfg.defaultProject) ? cfg.defaultProject : null
    return { defaultProject, projects }
  } catch {
    return { defaultProject: null, projects: [] }
  }
}

/**
 * 构建 qoder_task 工具定义（项目清单动态注入 description）
 */
function buildQoderTaskTool({ projects, defaultProject, fallbackRoot }) {
  const list = projects.length
    ? projects.map(p => `- ${p.name} → ${p.path}${p.description ? `（${p.description}）` : ''}`).join('\n')
    : `- （未注册项目，默认工作在 ${fallbackRoot}；用 mail-app projects add 登记更多项目）`
  const defaultName = defaultProject || `${fallbackRoot}（默认）`

  return {
    type: 'function',
    function: {
      name: 'qoder_task',
      description: `把编码或代码分析任务交给 Qoder CLI（AI 编程 Agent）在真实代码仓库中执行。适用于：修改/新增代码、修 bug、重构、代码审查、跨文件分析等超出简单读写能力的任务。任务描述要具体完整（像给一个人类工程师下任务单），Qoder 会自主读文件、改代码、跑命令并返回结果报告。

可用项目（project 参数填 name，不填时默认 ${defaultName}）：
${list}`,
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: '任务描述。要具体：目标、涉及范围、验收标准。例如「给 apps/mail-app/src/gateway.mjs 的健康检查接口加上运行时长统计字段」'
          },
          project: {
            type: 'string',
            description: '项目名（见上方可用项目列表）。用户提到「某某项目」时据此选择'
          },
          cwd: {
            type: 'string',
            description: '工作目录（可选）。相对所选项目根的子目录路径，或允许范围内的绝对路径。默认为项目根'
          },
          max_turns: {
            type: 'number',
            description: '最大执行轮数（可选，默认 25）。复杂任务可调高，防止失控'
          }
        },
        required: ['task']
      }
    }
  }
}

/**
 * 解析 qodercli 可执行文件路径
 */
function resolveQoderBin(binPath) {
  if (binPath) return binPath
  if (process.env.QODER_CLI_BIN) return process.env.QODER_CLI_BIN
  const defaultBin = path.join(os.homedir(), '.local', 'bin', 'qodercli')
  if (fs.existsSync(defaultBin)) return defaultBin
  return 'qodercli' // 兜底：交给 PATH
}

/**
 * 从 qodercli stdout 中解析 JSON 输出
 * （stdout 可能混杂日志行，从后往前找完整的 JSON 对象）
 */
function parseQoderOutput(stdout) {
  const text = (stdout || '').trim()
  if (!text) return null
  // 整体就是 JSON
  if (text.startsWith('{')) {
    try { return JSON.parse(text) } catch { /* 继续逐行找 */ }
  }
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.startsWith('{') && line.endsWith('}')) {
      try { return JSON.parse(line) } catch { continue }
    }
  }
  return null
}

/**
 * 创建 Qoder 工具组（tools + handlers）
 *
 * @param {object} opts
 * @param {string} [opts.binPath] - qodercli 路径（可选，默认自动解析）
 * @param {string} [opts.allowedRoot] - 额外允许的根目录（默认 monorepo 根，永远在白名单内）
 * @param {number} [opts.timeout=600000] - 超时毫秒数（默认 10 分钟）
 */
export function createQoderToolGroup({ binPath, allowedRoot, timeout = 600000 } = {}) {
  const bin = resolveQoderBin(binPath)
  const { projects, defaultProject } = loadQoderProjects()
  const fallbackRoot = path.resolve(allowedRoot || MONOREPO_ROOT)

  // 多根白名单 = 注册项目 + fallback 根（monorepo 根永远允许）
  const roots = projects.map(p => p.path)
  if (!roots.includes(fallbackRoot)) roots.push(fallbackRoot)

  const defaultRoot = projects.find(p => p.name === defaultProject)?.path || fallbackRoot

  const tools = [buildQoderTaskTool({ projects, defaultProject, fallbackRoot })]

  const handlers = {
    qoder_task: async (args = {}) => {
      const { task, project, cwd, max_turns } = args

      if (!task || typeof task !== 'string') {
        throw new Error('缺少必要参数: task（任务描述）')
      }

      // 1) 确定项目根：project 参数 > defaultProject > fallback
      let root = defaultRoot
      if (project) {
        const hit = projects.find(p => p.name === project)
        if (!hit) {
          const available = projects.map(p => p.name).join(', ')
          throw new Error(`未知项目: ${project}。可用项目: ${available || '（无，未注册任何项目）'}`)
        }
        root = hit.path
      }

      // 2) 解析 cwd（相对路径相对项目根），并做多根白名单校验
      const abs = cwd
        ? (path.isAbsolute(cwd) ? cwd : path.resolve(root, cwd))
        : root
      const normalized = path.resolve(abs)
      if (!roots.some(r => normalized === r || normalized.startsWith(r + path.sep))) {
        throw new Error(`工作目录越界: ${normalized}（允许的项目根: ${roots.join(', ')}）`)
      }
      if (!fs.existsSync(normalized)) {
        throw new Error(`工作目录不存在: ${normalized}`)
      }
      const workDir = normalized

      const cliArgs = [
        '-p', task,
        '-w', workDir,
        '--permission-mode', 'accept_edits',
        '--output-format', 'json',
        '--max-turns', String(Math.min(Math.max(Number(max_turns) || 25, 1), 100))
      ]

      const result = await new Promise((resolve) => {
        execFile(bin, cliArgs, {
          timeout,
          maxBuffer: 20 * 1024 * 1024,
          cwd: workDir,
          env: { ...process.env }
        }, (err, stdout, stderr) => {
          resolve({ err, stdout, stderr })
        })
      })

      const parsed = parseQoderOutput(result.stdout)

      if (result.err) {
        // 超时或进程错误：若仍有可用输出则透传
        if (parsed) {
          return {
            message: 'Qoder 执行异常退出，但拿到了部分结果',
            partial: true,
            exitError: result.err.message,
            result: parsed.result || ''
          }
        }
        throw new Error(`Qoder CLI 执行失败: ${result.err.message}${result.stderr ? ` | ${result.stderr.slice(0, 500)}` : ''}`)
      }

      if (!parsed) {
        throw new Error(`Qoder CLI 输出无法解析: ${(result.stdout || '').slice(0, 500)}`)
      }

      // 只提炼关键字段，减少对上层 LLM 上下文的占用
      return {
        message: parsed.is_error ? 'Qoder 任务执行出错' : 'Qoder 任务完成',
        result: parsed.result || '',
        isError: !!parsed.is_error,
        subtype: parsed.subtype,
        turns: parsed.num_turns,
        durationMs: parsed.duration_ms,
        workDir,
        ...(parsed.permission_denials?.length ? { permissionDenied: parsed.permission_denials } : {})
      }
    }
  }

  return { tools, handlers }
}
