/**
 * chat-core Qoder CLI 工具组
 *
 * 工具：
 *   - qoder_task(task, cwd?, max_turns?)  把编码/分析任务交给 Qoder CLI headless 执行
 *
 * 执行方式：
 *   qodercli -p "<task>" -w <cwd> --permission-mode accept_edits \
 *            --output-format json --max-turns <n>
 *
 * 安全：
 *   - 权限锁定 accept_edits：文件编辑自动通过，危险 Shell 命令被 Qoder 拒绝
 *   - cwd 限制在配置根目录内（默认 xingseq 仓库），禁止越界
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

export const qoderTaskTool = {
  type: 'function',
  function: {
    name: 'qoder_task',
    description: '把编码或代码分析任务交给 Qoder CLI（AI 编程 Agent）在真实代码仓库中执行。适用于：修改/新增代码、修 bug、重构、代码审查、跨文件分析等超出简单读写能力的任务。任务描述要具体完整（像给一个人类工程师下任务单），Qoder 会自主读文件、改代码、跑命令并返回结果报告。',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '任务描述。要具体：目标、涉及范围、验收标准。例如「给 apps/mail-app/src/gateway.mjs 的健康检查接口加上运行时长统计字段」'
        },
        cwd: {
          type: 'string',
          description: '工作目录（可选）。必须位于允许的项目根目录内，默认为项目根目录'
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

export const QODER_TOOLS = [qoderTaskTool]

const MONOREPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

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
 * 校验 cwd 在允许的根目录内，返回绝对路径
 */
function resolveCwd(cwd, allowedRoot) {
  const abs = cwd
    ? (path.isAbsolute(cwd) ? cwd : path.resolve(allowedRoot, cwd))
    : allowedRoot
  const normalized = path.resolve(abs)
  if (normalized !== allowedRoot && !normalized.startsWith(allowedRoot + path.sep)) {
    throw new Error(`工作目录越界: ${normalized}（仅允许 ${allowedRoot} 内）`)
  }
  if (!fs.existsSync(normalized)) {
    throw new Error(`工作目录不存在: ${normalized}`)
  }
  return normalized
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
 * 创建 Qoder 工具处理器
 *
 * @param {object} opts
 * @param {string} [opts.binPath] - qodercli 路径（可选，默认自动解析）
 * @param {string} [opts.allowedRoot] - 允许的工作目录根（默认 monorepo 根）
 * @param {number} [opts.timeout=600000] - 超时毫秒数（默认 10 分钟）
 */
export function createQoderHandlers({ binPath, allowedRoot, timeout = 600000 } = {}) {
  const bin = resolveQoderBin(binPath)
  const root = path.resolve(allowedRoot || MONOREPO_ROOT)

  return {
    qoder_task: async (args = {}) => {
      const { task, cwd, max_turns } = args

      if (!task || typeof task !== 'string') {
        throw new Error('缺少必要参数: task（任务描述）')
      }

      const workDir = resolveCwd(cwd, root)

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
        ...(parsed.permission_denials?.length ? { permissionDenied: parsed.permission_denials } : {})
      }
    }
  }
}
