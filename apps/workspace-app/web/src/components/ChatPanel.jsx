import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatStream, fetchJSON } from '../sseClient.js'

/** 工具事件可折叠卡片 */
function ToolEventCard({ te }) {
  const [expanded, setExpanded] = useState(false)

  if (te.type === 'call') {
    return (
      <div className="tool-card tool-card-call">
        <div className="tool-card-header" onClick={() => te.args && setExpanded(!expanded)}>
          <span className="tool-card-icon">⚙</span>
          <span className="tool-card-name">{te.name}</span>
          {te.args && <span className="tool-card-toggle">{expanded ? '▾' : '▸'}</span>}
        </div>
        {expanded && te.args && (
          <pre className="tool-card-body">{JSON.stringify(te.args, null, 2)}</pre>
        )}
      </div>
    )
  }

  if (te.type === 'result') {
    const preview = te.error || (typeof te.result === 'string' ? te.result : JSON.stringify(te.result))
    const isLong = preview && preview.length > 120
    return (
      <div className={`tool-card tool-card-result${te.error ? ' tool-card-error' : ''}`}>
        <div className="tool-card-header" onClick={() => isLong && setExpanded(!expanded)}>
          <span className="tool-card-icon">{te.error ? '✗' : '✓'}</span>
          <span className="tool-card-name">{te.name}</span>
          {!expanded && <span className="tool-card-preview">{preview?.slice(0, 100)}</span>}
          {isLong && <span className="tool-card-toggle">{expanded ? '▾' : '▸'}</span>}
        </div>
        {expanded && (
          <pre className="tool-card-body">{preview}</pre>
        )}
      </div>
    )
  }

  if (te.type === 'denied') {
    return (
      <div className="tool-card tool-card-denied">
        <span className="tool-card-icon">⊘</span>
        <span className="tool-card-name">{te.name}</span>
        <span className="tool-card-status">已拒绝</span>
      </div>
    )
  }
  return null
}

/**
 * 对话面板：消息列表 + 输入框 + 流式状态 + 对话管理
 */
export default function ChatPanel({
  conversations,
  currentId,
  currentTitle,
  workspace,
  workspacePath,
  workspaceQs,
  onSetCurrentId,
  onSetCurrentTitle,
  onSetMessages,
  messages,
  onError,
  onRefreshConversations,
  onRefreshFiles,
  inputRef
}) {
  const [streaming, setStreaming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [input, setInput] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const scrollRef = useRef(null)

  // 对话下拉菜单
  const [convDropdown, setConvDropdown] = useState(false)

  // 滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streaming])

  // ===== 拖拽文件路径到输入框 =====
  function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }
  function handleDragLeave() { setDragOver(false) }
  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const text = e.dataTransfer.getData('text/plain')
    if (!text) return
    setInput(prev => {
      const insert = prev && !/[\s]$/.test(prev) ? ' ' + text : text
      return prev + insert
    })
    inputRef.current?.focus()
  }

  async function handleNew() {
    try {
      const data = await fetchJSON(
        `/api/conversation/new?${workspaceQs()}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      )
      onSetCurrentId(data.id)
      onSetCurrentTitle(data.title)
      onSetMessages([])
      setStreaming(null)
      await onRefreshConversations()
    } catch (e) { setError(e.message) }
  }

  async function handleSelect(id) {
    if (id === currentId) { setConvDropdown(false); return }
    try {
      const data = await fetchJSON(`/api/conversation/${encodeURIComponent(id)}?${workspaceQs()}`)
      onSetCurrentId(id)
      onSetCurrentTitle(data.title || id)
      onSetMessages(data.messages || [])
      setStreaming(null)
      setConvDropdown(false)
    } catch (e) { setError(e.message) }
  }

  async function handleDelete(id, e) {
    e.stopPropagation()
    if (!confirm(`删除对话 ${id}？`)) return
    try {
      await fetch(`/api/conversation/${encodeURIComponent(id)}?${workspaceQs()}`, { method: 'DELETE' })
      if (id === currentId) { onSetCurrentId(null); onSetMessages([]) }
      await onRefreshConversations()
    } catch (err) { setError(err.message) }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || busy) return

    let convId = currentId
    if (!convId) {
      const data = await fetchJSON(
        `/api/conversation/new?${workspaceQs()}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      ).catch(e => { setError(e.message); return null })
      if (!data) return
      convId = data.id
      onSetCurrentId(convId)
      onSetCurrentTitle(data.title)
    }

    onSetMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setError(null)
    setBusy(true)
    setStreaming({ content: '', reasoning: '', toolEvents: [], phase: 'working' })

    try {
      await chatStream({
        workspace,
        workspacePath,
        conversationId: convId,
        message: text,
        onEvent: ({ event, data }) => {
          if (event === 'chunk') {
            setStreaming(prev => {
              if (!prev) return prev
              if (data.type === 'RESPONSE' || data.type === 'CONTENT') {
                return { ...prev, content: prev.content + (data.content || ''), phase: 'responding' }
              }
              if (data.type === 'THINK') {
                return { ...prev, reasoning: prev.reasoning + (data.content || ''), phase: 'thinking' }
              }
              return prev
            })
          } else if (event === 'tool_call') {
            setStreaming(prev => prev ? {
              ...prev, phase: 'executing',
              toolEvents: [...prev.toolEvents, { type: 'call', ...data }]
            } : prev)
          } else if (event === 'tool_result') {
            setStreaming(prev => prev ? {
              ...prev, phase: 'working',
              toolEvents: [...prev.toolEvents, { type: 'result', ...data }]
            } : prev)
          } else if (event === 'tool_denied') {
            setStreaming(prev => prev ? {
              ...prev, phase: 'working',
              toolEvents: [...prev.toolEvents, { type: 'denied', ...data }]
            } : prev)
          } else if (event === 'confirm_request') {
            // 传递给父组件的确认机制
            onError(null)
            window.dispatchEvent(new CustomEvent('workspace-confirm', { detail: data }))
          } else if (event === 'done') {
            onSetMessages(data.messages || [])
            setStreaming(null)
            onRefreshConversations()
            onRefreshFiles()
          } else if (event === 'error') {
            setError(data.message || '未知错误')
            setStreaming(null)
          }
        }
      })
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setStreaming(null)
      setBusy(false)
    }
  }

  return (
    <>
      {/* 对话选择器（下拉式） */}
      <div className="conv-bar">
        <button onClick={handleNew} className="btn-new" title="新建对话">+</button>
        <div className="conv-selector">
          <button
            className="conv-selector-btn"
            onClick={() => setConvDropdown(!convDropdown)}
          >
            <span className="conv-selector-title">{currentTitle || '选择对话…'}</span>
            <span className="conv-selector-arrow">{convDropdown ? '▾' : '▸'}</span>
          </button>
          {convDropdown && (
            <div className="conv-dropdown">
              {conversations.length === 0 && <div className="conv-dropdown-empty">暂无对话</div>}
              {conversations.map(c => (
                <div
                  key={c.id}
                  className={`conv-dropdown-item${c.id === currentId ? ' active' : ''}`}
                  onClick={() => handleSelect(c.id)}
                >
                  <span className="conv-dropdown-title">{c.title || c.id}</span>
                  <button className="btn-del" onClick={e => handleDelete(c.id, e)} title="删除">×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 消息区 */}
      <div className="messages" ref={scrollRef}>
        {messages.filter(m => m.role !== 'system').map((msg, i) => (
          <div key={i} className={`msg msg-${msg.role}`}>
            <div className="msg-role">{msg.role === 'user' ? '你' : 'AI'}</div>
            <div className="msg-content">
              {msg.role === 'assistant' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || ''}</ReactMarkdown>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="msg msg-assistant streaming">
            <div className="msg-role">AI</div>
            <div className="msg-content">
              {streaming.reasoning && (
                <details open className="thinking">
                  <summary>思考中…</summary>
                  <pre>{streaming.reasoning}</pre>
                </details>
              )}
              {streaming.content && (
                <div className="md-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming.content}</ReactMarkdown>
                </div>
              )}
              {streaming.toolEvents.length > 0 && (
                <div className="tool-events">
                  {streaming.toolEvents.map((te, i) => (
                    <ToolEventCard key={i} te={te} />
                  ))}
                </div>
              )}
              {/* 实时工作状态指示器 */}
              <div className="ai-status">
                <span className="ai-status-dots">
                  <span /><span /><span />
                </span>
                <span className="ai-status-text">
                  {(() => {
                    const te = streaming.toolEvents
                    if (te.length > 0 && te[te.length - 1].type === 'call') {
                      return `正在执行 ${te[te.length - 1].name}…`
                    }
                    switch (streaming.phase) {
                      case 'thinking': return '正在思考…'
                      case 'executing': return '正在执行工具…'
                      case 'responding': return '正在回复…'
                      case 'working':
                        return te.length > 0 ? '正在处理工具结果…' : 'AI 正在工作…'
                      default: return 'AI 正在工作…'
                    }
                  })()}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div
        className={`input-area${dragOver ? ' drag-over' : ''}${busy ? ' busy' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {(error) && <div className="error">{error}</div>}
        {dragOver && <div className="drop-hint">松开以插入文件路径</div>}
        {busy && (
          <div className="busy-hint">
            <span className="busy-dot" />
            <span>AI 正在工作，请稍候…</span>
          </div>
        )}
        <div className="input-row">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="输入消息…（Enter 发送，Shift+Enter 换行；可拖拽左侧文件到此处）"
            disabled={busy}
            rows={2}
          />
          <button onClick={handleSend} disabled={busy || !input.trim()}>
            {busy ? '…' : '发送'}
          </button>
        </div>
      </div>
    </>
  )
}
