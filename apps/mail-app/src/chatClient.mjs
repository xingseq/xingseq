/**
 * mail-app 调用 chat-app 的统一客户端
 *
 * 两种模式：
 *   1. CLI（默认）：子进程调 `chat-app --once --live --json`，解析 JSON stdout
 *   2. SSE：HTTP POST → chat-app server /api/chat，消费 SSE 流拿 done 事件
 *
 * 对话记忆：通过 conversationId 复用 chat-app 的 workspace 记忆
 *   - mail-app 按发件人邮箱生成 conversationId: `mail-<sender>`
 *   - 同一发件人的多封邮件共享上下文
 */

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import http from 'node:http'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CHAT_APP_CLI = path.resolve(__dirname, '../../chat-app/src/cli.mjs')

/**
 * 通过 CLI 调用 chat-app
 *
 * @param {object} opts
 * @param {string} opts.message - 消息内容
 * @param {string} [opts.conversationId] - 会话 ID（用于记忆续接）
 * @param {string} [opts.workspace] - workspace 名称
 * @param {boolean} [opts.live=true] - 是否用真实 LLM
 * @returns {Promise<{success, reply, conversationId, toolCalls, toolResults, error}>}
 */
export function chatViaCli({ message, conversationId, workspace, live = true }) {
  const args = ['--once', '--json']
  if (live) args.push('--live')
  if (conversationId) args.push('--resume', conversationId)
  if (workspace) args.push('--workspace', workspace)
  args.push(message)

  return new Promise((resolve) => {
    execFile('node', [CHAT_APP_CLI, ...args], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
      cwd: path.resolve(__dirname, '../..')
    }, (err, stdout, stderr) => {
      if (err) {
        // 进程非零退出也可能有 JSON 输出
        const jsonResult = tryParseJson(stdout)
        if (jsonResult) {
          resolve(jsonResult)
          return
        }
        resolve({
          success: false,
          reply: '',
          error: `chat-app CLI 失败: ${err.message}`,
          stderr: stderr?.slice(0, 500)
        })
        return
      }

      const result = tryParseJson(stdout)
      if (result) {
        resolve(result)
      } else {
        resolve({
          success: false,
          reply: '',
          error: `无法解析 chat-app CLI 输出: ${stdout.slice(0, 500)}`
        })
      }
    })
  })
}

/**
 * 通过 SSE 调用 chat-app server
 *
 * @param {object} opts
 * @param {string} opts.message - 消息内容
 * @param {string} opts.conversationId - 会话 ID
 * @param {string} [opts.workspace] - workspace 名称
 * @param {string} [opts.host='localhost']
 * @param {number} [opts.port=3001]
 * @returns {Promise<{success, reply, conversationId, toolCalls, toolResults, error}>}
 */
export function chatViaSse({
  message,
  conversationId,
  workspace = 'mail-gateway',
  host = 'localhost',
  port = 3001
}) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ conversationId, message })
    const req = http.request({
      hostname: host,
      port,
      path: `/api/chat?workspace=${encodeURIComponent(workspace)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let reply = ''
      const toolCalls = []
      const toolResults = []
      let buffer = ''

      res.on('data', (chunk) => {
        buffer += chunk.toString()
        // SSE 事件以 \n\n 分隔
        const parts = buffer.split('\n\n')
        buffer = parts.pop() // 保留不完整的部分

        for (const part of parts) {
          const lines = part.split('\n')
          let eventType = null
          let data = null

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              try {
                data = JSON.parse(line.slice(6))
              } catch { data = null }
            }
          }

          if (!eventType || !data) continue

          if (eventType === 'chunk' && data.type === 'RESPONSE' && data.content) {
            reply += data.content
          } else if (eventType === 'tool_call') {
            toolCalls.push({ name: data.name, arguments: data.args })
          } else if (eventType === 'tool_result') {
            toolResults.push({
              name: data.name,
              success: !data.error,
              result: data.result,
              error: data.error
            })
          } else if (eventType === 'done') {
            resolve({
              success: data.success,
              reply: reply || data.messages?.filter(m => m.role === 'assistant').pop()?.content || '',
              conversationId: data.conversationId,
              toolCalls,
              toolResults,
              error: data.error?.message || null
            })
            return
          } else if (eventType === 'error') {
            resolve({
              success: false,
              reply: '',
              conversationId,
              toolCalls,
              toolResults,
              error: data.message || 'SSE error'
            })
            return
          }
        }
      })

      res.on('error', (err) => {
        resolve({
          success: false,
          reply: '',
          error: `SSE 连接错误: ${err.message}`
        })
      })

      res.on('end', () => {
        // 如果没有收到 done 事件就结束了
        resolve({
          success: false,
          reply,
          conversationId,
          toolCalls,
          toolResults,
          error: 'SSE 连接提前关闭，未收到 done 事件'
        })
      })
    })

    req.on('error', (err) => {
      resolve({
        success: false,
        reply: '',
        error: `无法连接 chat-app server: ${err.message}（请确认 server 已启动）`
      })
    })

    req.write(body)
    req.end()
  })
}

/**
 * 统一调用入口
 *
 * @param {object} opts
 * @param {string} opts.message - 消息内容
 * @param {string} [opts.conversationId] - 会话 ID
 * @param {string} [opts.workspace] - workspace 名称
 * @param {'cli'|'sse'} [opts.mode='cli'] - 调用模式
 * @param {boolean} [opts.live=true] - CLI 模式下是否用真实 LLM
 * @param {object} [opts.sseConfig] - SSE 模式配置 { host, port }
 * @returns {Promise<{success, reply, conversationId, toolCalls, toolResults, error}>}
 */
export async function chatWithAssistant({
  message,
  conversationId,
  workspace,
  mode = 'cli',
  live = true,
  sseConfig = {}
}) {
  if (mode === 'sse') {
    return chatViaSse({ message, conversationId, workspace, ...sseConfig })
  }
  return chatViaCli({ message, conversationId, workspace, live })
}

/**
 * 按发件人邮箱生成 conversationId
 * 同一发件人的多封邮件共享上下文
 */
export function getConversationId(senderEmail) {
  // 提取纯邮箱地址
  const match = senderEmail.match(/<([^>]+)>/)
  const email = (match ? match[1] : senderEmail).trim().toLowerCase()
  return `mail-${email}`
}

// ===== helpers =====

function tryParseJson(text) {
  if (!text) return null
  const lines = text.trim().split('\n')
  // 从最后一行开始找 JSON
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        return JSON.parse(line)
      } catch { continue }
    }
  }
  return null
}
