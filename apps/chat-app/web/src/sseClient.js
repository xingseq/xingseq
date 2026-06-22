/**
 * chat-app 前端 SSE 客户端
 *
 * 浏览器原生 EventSource 不支持 POST，因此用 fetch + ReadableStream 自行解析 SSE 报文。
 */

export async function chatStream({ workspace, conversationId, message, onEvent, signal }) {
  const url = `/api/chat?workspace=${encodeURIComponent(workspace)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, message }),
    signal
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`请求失败 ${res.status}: ${text || res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''

  // SSE 解析：以 "\n\n" 切分事件块；每块内 event:/data: 行解析
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      if (!raw.trim() || raw.startsWith(':')) continue // 注释 / 空块跳过

      let event = 'message'
      const dataLines = []
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (!dataLines.length) continue
      const dataStr = dataLines.join('\n')
      let data
      try { data = JSON.parse(dataStr) }
      catch { data = dataStr }

      onEvent({ event, data })
    }
  }
}

export async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}: ${text || res.statusText}`)
  }
  return res.json()
}
