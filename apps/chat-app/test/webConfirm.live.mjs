#!/usr/bin/env node
/**
 * Web 端确认弹窗 live 验证（直接打 SSE，不需要浏览器）
 *
 * 用法：
 *   node test/webConfirm.live.mjs <port> <mode> <message>
 *     mode: confirm | deny | timeout
 *
 * 例：
 *   node test/webConfirm.live.mjs 3011 confirm "用 set_file_content 写 web-confirm.txt 内容 ok"
 *   node test/webConfirm.live.mjs 3011 deny    "用 execute_command 跑 ls"
 *   node test/webConfirm.live.mjs 3011 timeout "用 set_file_content 写 web-timeout.txt 内容 ok"
 */
import http from 'node:http'

const port = parseInt(process.argv[2] || '3011', 10)
const mode = process.argv[3] || 'confirm'
const message = process.argv[4] || '请用 set_file_content 写 web-test.txt 内容 ok'
const workspace = 'web-live-test'

function postJSON (path, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body), 'utf-8')
    const req = http.request({
      host: 'localhost', port, method: 'POST', path,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf-8')
        try { resolve(JSON.parse(txt)) } catch { resolve(txt) }
      })
    })
    req.on('error', reject)
    req.write(data); req.end()
  })
}

async function newConversation () {
  return postJSON(`/api/conversation/new?workspace=${workspace}`, {})
}

async function sendConfirm (confirmId, confirmed) {
  return postJSON('/api/confirm', { confirmId, confirmed })
}

async function main () {
  const conv = await newConversation()
  console.log(`[conv] id=${conv.id}`)

  const events = []
  let firstConfirmHandled = false

  await new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify({
      conversationId: conv.id, message
    }), 'utf-8')
    const req = http.request({
      host: 'localhost', port, method: 'POST',
      path: `/api/chat?workspace=${workspace}`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, (res) => {
      let buf = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk) => {
        buf += chunk
        // 简单 SSE 解析：以双换行分包
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2)
          let event = 'message'; let dataLine = ''
          for (const ln of block.split('\n')) {
            if (ln.startsWith('event:')) event = ln.slice(6).trim()
            else if (ln.startsWith('data:')) dataLine += ln.slice(5).trim()
          }
          if (!dataLine) continue
          let payload = null
          try { payload = JSON.parse(dataLine) } catch { payload = dataLine }
          events.push({ event, payload })

          if (event === 'confirm_request' && !firstConfirmHandled) {
            firstConfirmHandled = true
            const { confirmId, toolName, countdown } = payload
            console.log(`[confirm_request] tool=${toolName} confirmId=${confirmId} countdown=${countdown}s`)
            if (mode === 'confirm') {
              setTimeout(() => sendConfirm(confirmId, true).then(r => console.log('[confirm-resp]', r)), 200)
            } else if (mode === 'deny') {
              setTimeout(() => sendConfirm(confirmId, false).then(r => console.log('[deny-resp]', r)), 200)
            } else {
              console.log('[timeout 模式] 故意不回，等 30s 自动放行')
            }
          } else if (event === 'tool_call') {
            console.log(`[tool_call] ${payload.name} args=${JSON.stringify(payload.args).slice(0, 120)}`)
          } else if (event === 'tool_result') {
            const r = payload.result ? JSON.stringify(payload.result).slice(0, 120) : `ERR ${payload.error}`
            console.log(`[tool_result] ${payload.name} → ${r}`)
          } else if (event === 'tool_denied') {
            console.log(`[tool_denied] ${payload.name}`)
          } else if (event === 'done') {
            console.log(`[done] success=${payload.success} depth=${payload.depth}`)
            resolve()
          } else if (event === 'error') {
            console.log(`[error] ${payload.message}`)
            reject(new Error(payload.message))
          }
        }
      })
      res.on('end', () => resolve())
      res.on('error', reject)
    })
    req.on('error', reject)
    req.write(data); req.end()
  })

  console.log(`\n[summary] 共 ${events.length} 个 SSE 事件`)
  const counts = events.reduce((m, e) => { m[e.event] = (m[e.event] || 0) + 1; return m }, {})
  for (const k of Object.keys(counts)) console.log(`  ${k}: ${counts[k]}`)
}

main().catch(err => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
