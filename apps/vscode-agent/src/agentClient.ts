import http from 'http'
import type { ChatEvent, ChatParams } from './types.js'

export class AgentClient {
  constructor(private getPort: () => number) {}

  /**
   * SSE 流式对话
   * 对应 server.mjs 的 POST /api/chat
   *
   * SSE 事件类型：
   *   chunk         — { type: 'RESPONSE'|'CONTENT'|'THINK', content: string }
   *   tool_call     — { id, name, args }
   *   tool_result   — { id, name, result, error }
   *   tool_denied   — { id, name }
   *   confirm_request — { confirmId, toolName, args, countdown }
   *   done          — { conversationId, success, messages }
   *   error         — { message }
   */
  async chat(params: ChatParams): Promise<void> {
    const port = this.getPort()
    const qs = new URLSearchParams()
    if (params.workspacePath) qs.set('workspacePath', params.workspacePath)
    else if (params.workspace) qs.set('workspace', params.workspace)

    const body = JSON.stringify({
      conversationId: params.conversationId,
      message: params.message
    })

    const options: http.RequestOptions = {
      hostname: 'localhost',
      port,
      path: `/api/chat?${qs.toString()}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }

    return new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Server returned ${res.statusCode}`))
          return
        }

        let buf = ''
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString('utf-8')

          // SSE 以双换行分隔事件
          let idx: number
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const raw = buf.slice(0, idx)
            buf = buf.slice(idx + 2)
            if (!raw.trim() || raw.startsWith(':')) continue

            let event = 'message'
            const dataLines: string[] = []
            for (const line of raw.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim()
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
            }
            if (!dataLines.length) continue

            let data: any
            try { data = JSON.parse(dataLines.join('\n')) }
            catch { data = dataLines.join('\n') }

            params.onEvent({ event, data })

            if (event === 'done' || event === 'error') {
              resolve()
              return
            }
          }
        })

        res.on('end', () => resolve())
        res.on('error', reject)
      })

      req.on('error', reject)
      if (params.signal) {
        params.signal.addEventListener('abort', () => req.destroy())
      }
      req.write(body)
      req.end()
    })
  }

  /** POST /api/confirm — 确认/拒绝工具调用 */
  async confirm(confirmId: string, confirmed: boolean): Promise<void> {
    const port = this.getPort()
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ confirmId, confirmed })
      const req = http.request({
        hostname: 'localhost',
        port,
        path: '/api/confirm',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        res.on('data', () => {})
        res.on('end', () => resolve())
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  /** POST /api/conversation/new — 新建对话 */
  async newConversation(workspacePath?: string): Promise<{ id: string; title: string }> {
    const port = this.getPort()
    const qs = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : ''
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port,
        path: `/api/conversation/new${qs}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = ''
        res.on('data', (c) => data += c)
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch (e) { reject(e) }
        })
      })
      req.on('error', reject)
      req.write('{}')
      req.end()
    })
  }

  /** GET /api/conversation/:id — 加载对话历史 */
  async getConversation(id: string, workspacePath?: string): Promise<{ messages: any[]; title: string }> {
    const port = this.getPort()
    const qs = new URLSearchParams()
    if (workspacePath) qs.set('workspacePath', workspacePath)
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/api/conversation/${encodeURIComponent(id)}?${qs}`, (res) => {
        let data = ''
        res.on('data', (c) => data += c)
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch (e) { reject(e) }
        })
      }).on('error', reject)
    })
  }
}
