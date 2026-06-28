import React, { useEffect, useRef, useState } from 'react'
import { chatStream, fetchJSON } from './sseClient.js'

/**
 * workspace-app 前端
 *
 * 双栏布局：左侧文件树 / 右侧对话
 * 顶部：工作区信息 + 对话列表切换
 */

/** 递归目录树节点 */
function TreeNode({ item, depth, expandedDirs, loadingDirs, selectedFile, onToggle, onClick, onContextMenu, onDragStart }) {
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
        onContextMenu={e => onContextMenu(e, item)}
        draggable
        onDragStart={e => onDragStart(e, item)}
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
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
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

  // 三栏可拖拽宽度
  const [filePanelWidth, setFilePanelWidth] = useState(240)
  const [chatWidth, setChatWidth] = useState(420)
  const dragRef = useRef(null)

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

  // 右键菜单 & 拖拽
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y, item } | null
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

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

  // ===== 分栏拖拽调整大小 =====
  function startDrag(e, pane) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = pane === 'file' ? filePanelWidth : chatWidth
    const minWidth = pane === 'file' ? 180 : 280
    const maxWidth = pane === 'file' ? 400 : 900
    dragRef.current = { pane, startX, startWidth, minWidth, maxWidth }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = pane === 'file' ? 'col-resize' : 'col-resize'
  }

  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current) return
      const { pane, startX, startWidth, minWidth, maxWidth } = dragRef.current
      const delta = pane === 'file'
        ? e.clientX - startX
        : startX - e.clientX
      const next = Math.min(maxWidth, Math.max(minWidth, startWidth + delta))
      if (pane === 'file') setFilePanelWidth(next)
      else setChatWidth(next)
    }
    function onUp() {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

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

  // ===== 路径计算 =====
  /** 将相对路径转为绝对路径 */
  function getAbsPath(item) {
    if (!workspacePath) return item.path
    if (item.path === '.') return workspacePath
    return `${workspacePath.replace(/\/$/, '')}/${item.path}`
  }

  // ===== 右键菜单 =====
  function handleCtxMenu(e, item) {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, item })
  }

  function closeCtxMenu() {
    setCtxMenu(null)
  }

  async function handleCopyPath() {
    if (!ctxMenu) return
    const absPath = getAbsPath(ctxMenu.item)
    try {
      await navigator.clipboard.writeText(absPath)
    } catch {
      // 备用：创建临时 input 复制
      const tmp = document.createElement('input')
      tmp.value = absPath
      document.body.appendChild(tmp)
      tmp.select()
      document.execCommand('copy')
      document.body.removeChild(tmp)
    }
    closeCtxMenu()
  }

  async function handleCopyName() {
    if (!ctxMenu) return
    try {
      await navigator.clipboard.writeText(ctxMenu.item.name)
    } catch {
      const tmp = document.createElement('input')
      tmp.value = ctxMenu.item.name
      document.body.appendChild(tmp)
      tmp.select()
      document.execCommand('copy')
      document.body.removeChild(tmp)
    }
    closeCtxMenu()
  }

  // 点击任意处关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return
    const handler = () => closeCtxMenu()
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [ctxMenu])

  // ===== 拖拽文件树节点到输入框 =====
  function handleDragStart(e, item) {
    const absPath = getAbsPath(item)
    e.dataTransfer.setData('text/plain', absPath)
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const text = e.dataTransfer.getData('text/plain')
    if (!text) return
    // 插入路径到输入框光标位置（或追加）
    setInput(prev => {
      if (!prev) return text
      // 末尾有空格或换行则直接追加，否则加空格分隔
      if (/[\s]$/.test(prev)) return prev + text
      return prev + ' ' + text
    })
    // 聚焦输入框
    inputRef.current?.focus()
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
              ...prev,
              phase: 'executing',
              toolEvents: [...prev.toolEvents, { type: 'call', ...data }]
            } : prev)
          } else if (event === 'tool_result') {
            setStreaming(prev => prev ? {
              ...prev,
              phase: 'working',
              toolEvents: [...prev.toolEvents, { type: 'result', ...data }]
            } : prev)
          } else if (event === 'tool_denied') {
            setStreaming(prev => prev ? {
              ...prev,
              phase: 'working',
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
      setStreaming(null)
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
        <aside className="sidebar file-panel" style={{ width: filePanelWidth }}>
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
                onContextMenu={handleCtxMenu}
                onDragStart={handleDragStart}
              />
            ))}
          </div>
        </aside>

        <div className="resize-handle" onMouseDown={e => startDrag(e, 'file')} title="拖拽调整文件栏宽度" />

        {/* 中间：文件内容 */}
        <section className="content-area">
          {selectedFile ? (
            <>
              <div className="content-header">
                <span className="content-title" title={selectedFile.path}>{selectedFile.name}</span>
                <button onClick={() => { setSelectedFile(null); setFileContent('') }} title="关闭">×</button>
              </div>
              <pre className="content-body">{fileContent}</pre>
            </>
          ) : (
            <div className="content-empty">
              <div className="content-empty-icon">📄</div>
              <div>在左侧选择文件以查看内容</div>
            </div>
          )}
        </section>

        <div className="resize-handle" onMouseDown={e => startDrag(e, 'chat')} title="拖拽调整聊天栏宽度" />

        {/* 右栏：对话 */}
        <section className="chat-area" style={{ width: chatWidth }}>
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
                  {/* 实时工作状态指示器 */}
                  <div className="ai-status">
                    <span className="ai-status-dots">
                      <span /><span /><span />
                    </span>
                    <span className="ai-status-text">
                      {(() => {
                        const te = streaming.toolEvents
                        // 有未完成的工具调用 → 显示正在执行
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
            {error && <div className="error">{error}</div>}
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
                {busy ? '工作中…' : '发送'}
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

      {/* 右键菜单 */}
      {ctxMenu && (
        <div
          className="ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <div className="ctx-menu-item" onClick={handleCopyPath}>
            📋 复制完整路径
          </div>
          <div className="ctx-menu-item" onClick={handleCopyName}>
            📄 复制文件名
          </div>
        </div>
      )}
    </div>
  )
}
