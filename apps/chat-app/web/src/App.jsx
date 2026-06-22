import React, { useEffect, useMemo, useRef, useState } from 'react'
import { chatStream, fetchJSON } from './sseClient.js'

/**
 * chat-app 最小前端
 *
 * 三栏：左侧对话列表 / 右上 messages 流 / 右下输入区
 * 顶部：workspace 切换 + 当前会话标题
 *
 * 流式策略：
 *   - 每次发送，本地立即 push user 消息 + 占位 assistant
 *   - 监听 SSE chunk 事件，累加到 streaming.content / streaming.reasoning
 *   - 监听 tool_call / tool_result，挂到 streaming.toolEvents
 *   - done 事件以 server 返回的完整 messages 覆盖本地（保证最终一致）
 */

export default function App() {
  const [workspaces, setWorkspaces] = useState([])
  const [workspace, setWorkspace] = useState('default')

  const [conversations, setConversations] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [currentTitle, setCurrentTitle] = useState('')
  const [messages, setMessages] = useState([])

  // 流式临时状态（done 后清空）
  const [streaming, setStreaming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const [input, setInput] = useState('')
  const scrollRef = useRef(null)

  // ===== 拉 workspace 列表 =====
  useEffect(() => {
    fetchJSON('/api/workspaces')
      .then(d => setWorkspaces(d.workspaces || []))
      .catch(e => setError(e.message))
  }, [])

  // ===== workspace 切换：刷新对话列表，清空当前 =====
  useEffect(() => {
    setCurrentId(null)
    setMessages([])
    setStreaming(null)
    setError(null)
    refreshConversations(workspace)
  }, [workspace])

  async function refreshConversations(ws = workspace) {
    try {
      const data = await fetchJSON(`/api/conversations?workspace=${encodeURIComponent(ws)}`)
      setConversations(data.conversations || [])
    } catch (e) { setError(e.message) }
  }

  async function handleNew() {
    try {
      const data = await fetchJSON(
        `/api/conversation/new?workspace=${encodeURIComponent(workspace)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      )
      setCurrentId(data.id)
      setCurrentTitle(data.title)
      setMessages([])
      setStreaming(null)
      await refreshConversations()
    } catch (e) { setError(e.message) }
  }

  async function handleSelect(id) {
    if (id === currentId) return
    try {
      const data = await fetchJSON(`/api/conversation/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`)
      setCurrentId(id)
      setCurrentTitle(data.title || id)
      setMessages(data.messages || [])
      setStreaming(null)
    } catch (e) { setError(e.message) }
  }

  async function handleDelete(id, e) {
    e.stopPropagation()
    if (!confirm(`删除对话 ${id}？`)) return
    try {
      await fetch(`/api/conversation/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`, { method: 'DELETE' })
      if (id === currentId) {
        setCurrentId(null)
        setMessages([])
      }
      await refreshConversations()
    } catch (err) { setError(err.message) }
  }

  // ===== 发送消息（SSE 流式） =====
  async function handleSend() {
    const text = input.trim()
    if (!text || busy) return

    let convId = currentId
    if (!convId) {
      // 没选对话则自动新建
      const data = await fetchJSON(
        `/api/conversation/new?workspace=${encodeURIComponent(workspace)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      ).catch(e => { setError(e.message); return null })
      if (!data) return
      convId = data.id
      setCurrentId(convId)
      setCurrentTitle(data.title)
    }

    // 本地立即追加 user 消息
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setError(null)
    setBusy(true)
    setStreaming({ content: '', reasoning: '', toolEvents: [] })

    try {
      await chatStream({
        workspace,
        conversationId: convId,
        message: text,
        onEvent: ({ event, data }) => {
          if (event === 'chunk') {
            const t = data?.type
            const c = data?.content || ''
            setStreaming(s => {
              if (!s) return s
              if (t === 'CONTENT' || t === 'RESPONSE') return { ...s, content: s.content + c }
              if (t === 'THINK') return { ...s, reasoning: s.reasoning + c }
              return s
            })
          } else if (event === 'tool_call') {
            setStreaming(s => s ? {
              ...s,
              toolEvents: [...s.toolEvents, { id: data.id, name: data.name, args: data.args, status: 'running' }]
            } : s)
          } else if (event === 'tool_result') {
            setStreaming(s => s ? {
              ...s,
              toolEvents: s.toolEvents.map(te =>
                te.id === data.id
                  ? { ...te, status: data.error ? 'error' : 'done', result: data.result, error: data.error }
                  : te
              ),
              // 工具结果回来 → 进入下一轮，content 清掉以接收下一轮的 assistant 文本
              content: '',
              reasoning: ''
            } : s)
          } else if (event === 'done') {
            if (Array.isArray(data.messages)) setMessages(data.messages)
            if (data.error) setError(data.error.message || JSON.stringify(data.error))
          } else if (event === 'error') {
            setError(data.message || 'unknown error')
          }
        }
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
      setStreaming(null)
      refreshConversations()
    }
  }

  // 自动滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streaming])

  const renderedMessages = useMemo(() => {
    // 把 tool 消息按 tool_call_id 挂回前一个 assistant 上展示
    const out = []
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (m.role === 'tool') continue // 在 assistant 里一并渲染
      out.push(m)
    }
    return out
  }, [messages])

  function findToolResult(callId) {
    return messages.find(m => m.role === 'tool' && m.tool_call_id === callId)
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">星序 · chat-app</div>
        <div className="workspace-switcher">
          <label>工作区：</label>
          <select value={workspace} onChange={e => setWorkspace(e.target.value)}>
            {!workspaces.find(w => w.name === workspace) && (
              <option value={workspace}>{workspace}</option>
            )}
            {workspaces.map(w => (
              <option key={w.name} value={w.name}>{w.name}</option>
            ))}
          </select>
        </div>
        <div className="status">
          {busy ? <span className="dot dot-busy" />: <span className="dot dot-idle" />}
          {busy ? '生成中…' : '就绪'}
        </div>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <button className="btn btn-primary" onClick={handleNew}>+ 新建对话</button>
          <div className="conv-list">
            {conversations.length === 0 && <div className="empty">暂无对话</div>}
            {conversations.map(c => (
              <div
                key={c.id}
                className={'conv-item ' + (c.id === currentId ? 'active' : '')}
                onClick={() => handleSelect(c.id)}
              >
                <div className="conv-title">{c.title || c.id}</div>
                <div className="conv-preview">{c.preview || '(空)'}</div>
                <div className="conv-meta">
                  <span>{c.messageCount} 条</span>
                  <button className="btn-mini btn-danger" onClick={(e) => handleDelete(c.id, e)}>×</button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="chat">
          <div className="chat-title">{currentTitle || '（未选择对话）'}</div>
          <div className="messages" ref={scrollRef}>
            {renderedMessages.length === 0 && !streaming && (
              <div className="welcome">
                <h3>欢迎使用 chat-app</h3>
                <p>可以试试这些问题（会触发工作区工具）：</p>
                <ul>
                  <li>「现在几点了，用 locale 格式」</li>
                  <li>「看一下我工作区有哪些文件」</li>
                  <li>「读一下 README.md 总结一下」</li>
                </ul>
              </div>
            )}

            {renderedMessages.map((m, i) => (
              <Bubble key={i} m={m} findToolResult={findToolResult} />
            ))}

            {streaming && (
              <StreamingBubble s={streaming} />
            )}
          </div>

          {error && <div className="error">⚠ {error}</div>}

          <div className="input-bar">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend()
              }}
              placeholder="输入消息（⌘/Ctrl + Enter 发送）"
              rows={3}
              disabled={busy}
            />
            <button className="btn btn-primary" onClick={handleSend} disabled={busy || !input.trim()}>
              {busy ? '发送中…' : '发送'}
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}

function Bubble({ m, findToolResult }) {
  const role = m.role
  const isUser = role === 'user'
  const hasToolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0

  return (
    <div className={'bubble bubble-' + role}>
      <div className="bubble-role">{isUser ? '我' : 'AI'}</div>
      <div className="bubble-body">
        {m.content && <div className="bubble-text">{m.content}</div>}
        {hasToolCalls && (
          <div className="tools">
            {m.tool_calls.map(tc => {
              const tr = findToolResult(tc.id)
              let argsStr = ''
              try {
                const a = typeof tc.function?.arguments === 'string'
                  ? JSON.parse(tc.function.arguments)
                  : (tc.function?.arguments || {})
                argsStr = JSON.stringify(a)
              } catch { argsStr = String(tc.function?.arguments || '') }
              return (
                <div key={tc.id} className="tool-card">
                  <div className="tool-head">
                    <span className="tool-icon">⚙</span>
                    <span className="tool-name">{tc.function?.name}</span>
                    <span className="tool-args">{argsStr}</span>
                  </div>
                  {tr && (
                    <pre className="tool-result">{truncate(tr.content, 600)}</pre>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StreamingBubble({ s }) {
  return (
    <div className="bubble bubble-assistant streaming">
      <div className="bubble-role">AI · 流式</div>
      <div className="bubble-body">
        {s.reasoning && (
          <details className="reasoning" open>
            <summary>思考过程</summary>
            <pre>{s.reasoning}</pre>
          </details>
        )}
        {s.toolEvents.length > 0 && (
          <div className="tools">
            {s.toolEvents.map(te => (
              <div key={te.id} className={'tool-card status-' + te.status}>
                <div className="tool-head">
                  <span className="tool-icon">{te.status === 'running' ? '⏳' : te.status === 'error' ? '✗' : '✓'}</span>
                  <span className="tool-name">{te.name}</span>
                  <span className="tool-args">{JSON.stringify(te.args || {})}</span>
                </div>
                {te.status !== 'running' && (
                  <pre className="tool-result">
                    {te.error ? `错误：${te.error}` : truncate(JSON.stringify(te.result), 600)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
        {s.content && <div className="bubble-text">{s.content}<span className="caret">▍</span></div>}
        {!s.content && !s.toolEvents.length && !s.reasoning && (
          <div className="bubble-text dim">正在思考…</div>
        )}
      </div>
    </div>
  )
}

function truncate(str, n) {
  if (typeof str !== 'string') str = String(str ?? '')
  return str.length > n ? str.slice(0, n) + '…' : str
}
