/**
 * chat-app shell 命令工具组
 *
 * 设计参考 develop/electron/tools/executors/commandExecutor.js：
 *   - 标准白名单（npm/git/node/ls/cat/grep 等基础命令）
 *   - 参数过滤（拒绝命令注入字符）
 *   - shell 元字符兜底：命中 && || | ; ` $ () < > 时整体走 bash -c "..."
 *     —— 兼容 LLM 习惯写出的 shell 语法（如 `git status | head -5`）
 *   - 强制 cwd = workspace.filesDir，禁止越权
 *   - 默认超时 30s，最大 5 分钟
 *
 * 仅暴露 execute_command（与 develop 一致），后续可按需扩展 launch_application。
 */

import { spawn } from 'node:child_process'
import {
  validateCommand,
  sanitizeCommandArgs,
  detectShellMeta,
  resolveSafePath,
  DEFAULT_COMMAND_TIMEOUT,
  MAX_COMMAND_TIMEOUT,
  ALLOWED_COMMANDS
} from '../security.js'

export const executeCommandTool = {
  type: 'function',
  function: {
    name: 'execute_command',
    description:
      `在工作区目录中执行白名单内的安全命令（npm/git/node/ls/cat/grep 等）。\n` +
      `允许的命令：${ALLOWED_COMMANDS.join(', ')}\n` +
      `若命令或参数包含 shell 元字符（&& || | ; \` $ () < >），系统会自动用 bash -c 执行（macOS/Linux）。\n` +
      `工作目录强制为工作区根，禁止越权。默认超时 30s，最大 5 分钟。`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令名（如 npm、git、ls）；也可包含 shell 元字符' },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: '命令参数数组，如 ["status", "--short"]'
        },
        cwd: {
          type: 'string',
          description: '相对于工作区根的子目录（可选，默认 .）'
        },
        timeout: {
          type: 'integer',
          description: '超时毫秒，默认 30000，最大 300000',
          default: 30000
        }
      },
      required: ['command']
    }
  }
}

export const SHELL_TOOLS = [executeCommandTool]

const MAX_CAPTURE_BYTES = 64 * 1024  // 单流最多回传 64KB，防止把 LLM 上下文撑爆

export function createShellHandlers({ cwd } = {}) {
  if (!cwd) throw new Error('createShellHandlers: cwd（workspace.filesDir）必填')

  return {
    execute_command: async (args = {}) => {
      const command = args.command
      const cmdArgs = Array.isArray(args.args) ? args.args : []
      const timeout = Math.min(
        Math.max(Number(args.timeout) || DEFAULT_COMMAND_TIMEOUT, 1000),
        MAX_COMMAND_TIMEOUT
      )

      // 工作目录：相对路径解析到 workspace 内
      const workingDir = args.cwd ? resolveSafePath(cwd, args.cwd) : cwd

      // 是否走 shell 模式
      const needsShell = detectShellMeta(command, cmdArgs)
      const isWindows = process.platform === 'win32'

      let actualCommand
      let actualArgs

      if (needsShell) {
        // 拼成完整命令字符串，交 bash -c / cmd /c 解析
        const fullCmd = [String(command), ...cmdArgs].join(' ').trim()
        if (isWindows) {
          actualCommand = 'cmd'
          actualArgs = ['/c', fullCmd]
        } else {
          actualCommand = 'bash'
          actualArgs = ['-c', fullCmd]
        }
      } else {
        // argv 模式：白名单 + 参数过滤
        const baseCommand = validateCommand(command)
        const sanitized = sanitizeCommandArgs(cmdArgs)
        if (sanitized.length !== cmdArgs.length) {
          throw new Error('检测到不安全的命令参数（含 ; ` $ () < > | & 等），已拒绝执行')
        }
        actualCommand = command
        actualArgs = sanitized
        // Windows 下 npm/npx/yarn 需要 .cmd 后缀
        if (isWindows && ['npm', 'npx', 'yarn'].includes(baseCommand)) {
          actualCommand = `${command}.cmd`
        }
      }

      return await new Promise((resolve, reject) => {
        let stdout = ''
        let stderr = ''
        let stdoutBytes = 0
        let stderrBytes = 0
        let isTimeout = false

        const child = spawn(actualCommand, actualArgs, {
          cwd: workingDir,
          shell: isWindows,
          windowsHide: true,
          env: { ...process.env, FORCE_COLOR: '0' }
        })

        const timer = setTimeout(() => {
          isTimeout = true
          child.kill('SIGTERM')
          setTimeout(() => { if (!child.killed) child.kill('SIGKILL') }, 2000)
        }, timeout)

        child.stdout?.on('data', d => {
          if (stdoutBytes < MAX_CAPTURE_BYTES) {
            const chunk = d.toString()
            stdout += chunk
            stdoutBytes += Buffer.byteLength(chunk, 'utf-8')
            if (stdoutBytes > MAX_CAPTURE_BYTES) {
              stdout = stdout.slice(0, MAX_CAPTURE_BYTES) + '\n...（输出已截断）'
            }
          }
        })
        child.stderr?.on('data', d => {
          if (stderrBytes < MAX_CAPTURE_BYTES) {
            const chunk = d.toString()
            stderr += chunk
            stderrBytes += Buffer.byteLength(chunk, 'utf-8')
            if (stderrBytes > MAX_CAPTURE_BYTES) {
              stderr = stderr.slice(0, MAX_CAPTURE_BYTES) + '\n...（输出已截断）'
            }
          }
        })

        child.on('error', err => {
          clearTimeout(timer)
          reject(err)
        })

        child.on('close', code => {
          clearTimeout(timer)
          if (isTimeout) {
            return reject(new Error(`命令执行超时（${timeout}ms），已被终止`))
          }
          resolve({
            command: actualCommand,
            args: actualArgs,
            cwd: workingDir,
            shellMode: needsShell,
            exit_code: code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            success: code === 0
          })
        })
      })
    }
  }
}
