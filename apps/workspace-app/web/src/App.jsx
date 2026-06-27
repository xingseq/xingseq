import React, { useEffect, useRef, useState } from 'react'
import { chatStream, fetchJSON } from './sseClient.js'

/**
 * workspace-app 前端
 *
 * 双栏布局：左侧文件树 / 右侧对话
 * 顶部：工作区信息 + 对话列表切换
 */

/** 递归目录树节点 */
function TreeNode({ item, depth, expandedDirs, loadingDirs, selectedFile, onToggle, onClick }) {
  const isDir = item.type === 'dir'
  const isExpanded = expandedDirs.has(item.path)
  const isLoading = loadingDirs.has(item.path)
  const isActive = selectedFile?.path === item.path

  return (
    <>
      <div
        className={`file-item ${item.type}${isActive ? ' active' : ''}${isExpanded ? ' expanded' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => onClick(item)}
        title={item.path}
      >
        {isDir && (
          <span className={`tree-arrow${isExpanded ? ' open' : ''}`}>▶</span>
        )}
        <span className="file-icon">{isDir ? (isExpanded ? '📂' : '📁') : '📄'}</span>
        <span className="file-name">{item.name}</span>
        {isLoading && <span className="tree-spinner">⋯</span>}
      </div>
      {isDir && isExpanded && item.children && (
        <div className="tree-children">
          {item.children.map(child => (
            <TreeNode
              key={child.path}
              item={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              loadingDirs={loadingDirs}
              selectedFile={selectedFile}
              onToggle={onToggle}
              onClick={onClick}
            />
          ))}
          {item.children.length === 0 && (
            <div className="empty" style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}>（空）</div>
          )}
        </div>
      )}
    </>
  )
}

export default function App() {
  const [workspaces, setWorkspaces] = useState([])
  const [workspace, setWorkspace] = useState('default')
  const [workspacePath, setWorkspacePath] = useState(null)

  const [conversations, setConversations] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [currentTitle, setCurrentTitle] = useState('')
  const [messages, setMessages] = useState([])

  // 文件树（递归结构：每个节点 { name, path, type, children?: [], loaded?: bool }）
  const [fileTree, setFileTree] = useState([])
  const [expandedDirs, setExpandedDirs] = useState(new Set())
  const [loadingDirs, setLoadingDirs] = useState(new Set())
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileContent, setFileContent] = useState('')

  // 流式状态
  const [streaming, setStreaming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [input, setInput] = useState('')
  const scrollRef = useRef(null)

  // 确认弹窗
  const [pendingConfirm, setPendingConfirm] = useState(null)
  const [countdownLeft, setCountdownLeft] = useState(0)
  const [countdownTotal, setCountdownTotal] = useState(0)

  // 确认弹窗倒计时（秒数从后端 payload.countdown 读取，进度条由 CSS 动画驱动）
  useEffect(() => {
    if (!pendingConfirm || !pendingConfirm.countdown) return
    const total = pendingConfirm.countdown
    setCountdownTotal(total)
    setCountdownLeft(total)
    const start = Date.now()
    const timer = setInterval(() => {
      const left = Math.max(0, total - Math.floor((Date.now() - start) / 1000))
      setCountdownLeft(left)
      if (left <= 0) {
        clearInterval(timer)
        setPendingConfirm(null) // 倒计时结束，后端将自动执行，关闭弹窗
      }
    }, 250)
    return () => {
      clearInterval(timer)
      setCountdownTotal(0)
      setCountdownLeft(0)
    }
  }, [pendingConfirm])

  // 挂载目录弹窗
  const [showMount, setShowMount] = useState(false)
  const [mountPath, setMountPath] = useState('')
  const [mounting, setMounting] = useState(false)

  // 构造 workspace 查询参数
  const workspaceQs = (extra = {}) => {
    const params = new URLSearchParams(extra)
    if (workspacePath) params.set('workspacePath', workspacePath)
    else params.set('workspace', workspace)
    return params.toString()
  }

  const selectWorkspace = (ws) => {
    if (ws.mounted) {
      setWorkspace(ws.name)
      setWorkspacePath(ws.root)
    } else {
      setWorkspace(ws.name)
      setWorkspacePath(null)
    }
  }

  // ===== 拉 workspace 列表 =====
  useEffect(() => {
    fetchJSON('/api/workspaces')
      .then(d => {
        const list = d.workspaces || []
        setWorkspaces(list)
        // 若当前 workspace 不在列表中，默认选中第一个
        const currentKey = workspacePath || workspace
        const exists = list.some(w => (w.mounted ? w.root : w.name) === currentKey)
        if (!exists && list.length > 0) {
          selectWorkspace(list[0])
        }
      })
      .catch(e => setError(e.message))
  }, [])

  // ===== workspace 切换 =====
  useEffect(() => {
    setCurrentId(null)
    setMessages([])
    setStreaming(null)
    setError(null)
    setFileTree([])
    setSelectedFile(null)
    refreshConversations()
    refreshFiles('.')
  }, [workspace, workspacePath])

  async function refreshConversations() {
    try {
      const data = await fetchJSON(`/api/conversations?${workspaceQs()}`)
      setConversations(data.conversations || [])
    } catch (e) { setError(e.message) }
  }

  /** 排序：目录在前，同类按名称排序 */
  function sortItems(items) {
    return [...items].sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name)
      return a.type === 'dir' ? -1 : 1
    })
  }

  async function refreshFiles(dirPath) {
    try {
      const data = await fetchJSON(`/api/files?${workspaceQs({ path: dirPath })}`)
      const items = sortItems(data.items || [])
      if (dirPath === '.') {
        setFileTree(items)
      }
      return items
    } catch (e) { setError(e.message); return [] }
  }

  /** 展开/折叠目录，懒加载子目录内容 */
  async function toggleDir(item) {
    const newExpanded = new Set(expandedDirs)
    if (newExpanded.has(item.path)) {
      newExpanded.delete(item.path)
      setExpandedDirs(newExpanded)
    } else {
      newExpanded.add(item.path)
      setExpandedDirs(newExpanded)
      // 如果尚未加载子目录内容则拉取
      if (!item.children) {
        setLoadingDirs(prev => new Set(prev).add(item.path))
        try {
          const children = await refreshFiles(item.path)
          // 将 children 写入树节点
          setFileTree(prev => injectChildren(prev, item.path, children))
        } finally {
          setLoadingDirs(prev => {
            const s = new Set(prev)
            s.delete(item.path)
            return s
          })
        }
      }
    }
  }

  /** 递归向文件树中注入子节点 */
  function injectChildren(tree, targetPath, children) {
    return tree.map(node => {
      if (node.path === targetPath) {
        return { ...node, children, loaded: true }
      }
      if (node.children) {
        return { ...node, children: injectChildren(node.children, targetPath, children) }
      }
      return node
    })
  }

  async function handleFileClick(item) {
    if (item.type === 'dir') {
      toggleDir(item)
    } else {
      setSelectedFile(item)
      try {
        const data = await fetchJSON(`/api/file?${workspaceQs({ path: item.path })}`)
        setFileContent(data.content || '')
      } catch (e) { setError(e.message) }
    }
  }

  // ===== 对话管理 =====
  async function handleNew() {
    try {
      const data = await fetchJSON(
        `/api/conversation/new?${workspaceQs()}`,
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
      const data = await fetchJSON(`/api/conversation/${encodeURIComponent(id)}?${workspaceQs()}`)
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
      await fetch(`/api/conversation/${encodeURIComponent(id)}?${workspaceQs()}`, { method: 'DELETE' })
      if (id === currentId) { setCurrentId(null); setMessages([]) }
      await refreshConversations()
    } catch (err) { setError(err.message) }
  }

  // ===== 发送消息 =====
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
      setCurrentId(convId)
      setCurrentTitle(data.title)
    }

    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setError(null)
    setBusy(true)
    setStreaming({ content: '', reasoning: '', toolEvents: [] })

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
                return { ...prev, content: prev.content + (data.content || '') }
              }
              if (data.type === 'THINK') {
                return { ...prev, reasoning: prev.reasoning + (data.content || '') }
              }
              return prev
            })
          } else if (event === 'tool_call') {
            setStreaming(prev => prev ? {
              ...prev,
              toolEvents: [...prev.toolEvents, { type: 'call', ...data }]
            } : prev)
          } else if (event === 'tool_result') {
            setStreaming(prev => prev ? {
              ...prev,
              toolEvents: [...prev.toolEvents, { type: 'result', ...data }]
            } : prev)
          } else if (event === 'tool_denied') {
            setStreaming(prev => prev ? {
              ...prev,
              toolEvents: [...prev.toolEvents, { type: 'denied', ...data }]
            } : prev)
          } else if (event === 'confirm_request') {
            setPendingConfirm(data)
          } else if (event === 'done') {
            setMessages(data.messages || [])
            setStreaming(null)
            refreshConversations()
            refreshFiles('.')
          } else if (event === 'error') {
            setError(data.message || '未知错误')
            setStreaming(null)
          }
        }
      })
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // 确认操作
  async function handleConfirm(confirmed) {
    if (!pendingConfirm) return
    try {
      await fetchJSON('/api/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmId: pendingConfirm.confirmId, confirmed })
      })
    } catch (e) { setError(e.message) }
    setPendingConfirm(null)
  }

  // 挂载新目录
  async function handleMount() {
    const p = mountPath.trim()
    if (!p) return
    setMounting(true)
    setError(null)
    try {
      const data = await fetchJSON('/api/workspace/mount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p })
      })
      const ws = data.workspace
      if (ws) {
        await fetchJSON('/api/workspaces')
          .then(d => setWorkspaces(d.workspaces || []))
          .catch(e => setError(e.message))
        selectWorkspace({ name: ws.name, root: ws.root, mounted: true })
      }
      setShowMount(false)
      setMountPath('')
    } catch (e) {
      setError(e.message)
    } finally {
      setMounting(false)
    }
  }

  // 滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streaming])

  // ===== 渲染 =====
  return (
    <div className="app">
      {/* 顶栏 */}
      <header className="header">
        <h1>workspace-app</h1>
        <div className="ws-selector">
          <div className="ws-current">
            <select
              value={workspacePath || workspace}
              onChange={e => {
                const selected = workspaces.find(w =>
                  w.mounted ? w.root === e.target.value : w.name === e.target.value
                )
                if (selected) selectWorkspace(selected)
              }}
            >
              {workspaces.map(w => (
                <option
                  key={w.mounted ? w.root : w.name}
                  value={w.mounted ? w.root : w.name}
                  title={w.mounted ? w.root : ''}
                >
                  {w.name}{w.mounted ? ' 📁' : ''}
                </option>
              ))}
              {workspaces.length === 0 && <option value="default">default</option>}
            </select>
            {workspacePath && (
              <span className="ws-path" title={workspacePath}>
                {workspacePath}
              </span>
            )}
          </div>
          <button className="btn-mount" onClick={() => setShowMount(true)} title="挂载本地目录">
            + 挂载
          </button>
        </div>
      </header>

      <div className="main">
        {/* 左栏：文件树 */}
        <aside className="sidebar file-panel">
          <div className="panel-header">
            <span>📂 文件</span>
            <button onClick={() => { setExpandedDirs(new Set()); refreshFiles('.') }} title="刷新">↻</button>
          </div>
          <div className="file-tree">
            {fileTree.length === 0 && <div className="empty">（空目录）</div>}
            {fileTree.map(item => (
              <TreeNode
                key={item.path}
                item={item}
                depth={0}
                expandedDirs={expandedDirs}
                loadingDirs={loadingDirs}
                selectedFile={selectedFile}
                onToggle={toggleDir}
                onClick={handleFileClick}
              />
            ))}
          </div>
          {selectedFile && (
            <div className="file-preview">
              <div className="preview-header">
                <span>{selectedFile.name}</span>
                <button onClick={() => { setSelectedFile(null); setFileContent('') }} title="关闭">×</button>
              </div>
              <pre className="preview-content">{fileContent}</pre>
            </div>
          )}
        </aside>

        {/* 右栏：对话 */}
        <section className="chat-area">
          {/* 对话列表 */}
          <div className="conv-bar">
            <button onClick={handleNew} className="btn-new">+ 新对话</button>
            <div className="conv-list">
              {conversations.map(c => (
                <div
                  key={c.id}
                  className={`conv-item ${c.id === currentId ? 'active' : ''}`}
                  onClick={() => handleSelect(c.id)}
                >
                  <span className="conv-title">{c.title || c.id}</span>
                  <button className="btn-del" onClick={e => handleDelete(c.id, e)}>×</button>
                </div>
              ))}
            </div>
          </div>

          {/* 消息区 */}
          <div className="messages" ref={scrollRef}>
            {messages.filter(m => m.role !== 'system').map((msg, i) => (
              <div key={i} className={`msg msg-${msg.role}`}>
                <div className="msg-role">{msg.role === 'user' ? '你' : 'AI'}</div>
                <div className="msg-content">{msg.content}</div>
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
                  {streaming.content && <div>{streaming.content}</div>}
                  {streaming.toolEvents.map((te, i) => (
                    <div key={i} className={`tool-event tool-${te.type}`}>
                      {te.type === 'call' && <span>⚙ {te.name}</span>}
                      {te.type === 'result' && <span>✓ {te.name}: {te.error || (te.result?.slice?.(0, 100) || JSON.stringify(te.result)?.slice(0, 100))}</span>}
                      {te.type === 'denied' && <span>✗ {te.name} 已拒绝</span>}
                    </div>
                  ))}
                  {!streaming.content && !streaming.reasoning && streaming.toolEvents.length === 0 && (
                    <span className="cursor">▌</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 输入区 */}
          <div className="input-area">
            {error && <div className="error">{error}</div>}
            <div className="input-row">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
                disabled={busy}
                rows={2}
              />
              <button onClick={handleSend} disabled={busy || !input.trim()}>
                {busy ? '…' : '发送'}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* 挂载目录弹窗 */}
      {showMount && (
        <div className="confirm-overlay">
          <div className="confirm-dialog mount-dialog">
            <h3>挂载本地目录</h3>
            <p>输入绝对路径作为工作区：</p>
            <input
              type="text"
              className="mount-input"
              value={mountPath}
              onChange={e => setMountPath(e.target.value)}
              placeholder="/Users/ws/Dev/your-project"
              onKeyDown={e => { if (e.key === 'Enter') handleMount() }}
              autoFocus
            />
            {error && <div className="error">{error}</div>}
            <div className="confirm-actions">
              <button
                className="btn-allow"
                onClick={handleMount}
                disabled={mounting || !mountPath.trim()}
              >
                {mounting ? '挂载中…' : '确认挂载'}
              </button>
              <button className="btn-deny" onClick={() => { setShowMount(false); setMountPath('') }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 确认弹窗 */}
      {pendingConfirm && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <h3>安全确认</h3>
            <p>工具 <strong>{pendingConfirm.toolName}</strong> 请求执行：</p>
            <pre className="confirm-args">{JSON.stringify(pendingConfirm.args, null, 2)}</pre>
            <div className="confirm-actions">
              <button className="btn-allow" onClick={() => handleConfirm(true)}>允许执行</button>
              <button className="btn-deny" onClick={() => handleConfirm(false)}>拒绝</button>
            </div>
            {countdownTotal > 0 && (
              <div className="confirm-progress">
                <div
                  className="confirm-progress-bar"
                  key={pendingConfirm.confirmId}
                  style={{ animationDuration: `${countdownTotal}s` }}
                />
              </div>
            )}
            <p className="confirm-hint">
              {countdownLeft > 0 ? `${countdownLeft} 秒后将自动执行` : '正在自动执行…'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
