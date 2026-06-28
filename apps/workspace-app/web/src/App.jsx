import React, { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJSON } from './sseClient.js'
import Header from './components/Header.jsx'
import FileTree from './components/FileTree.jsx'
import FileViewer from './components/FileViewer.jsx'
import ChatPanel from './components/ChatPanel.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'

/**
 * workspace-app 前端
 *
 * 三栏布局：左侧文件树 / 中间文件内容 / 右侧对话
 * 顶部：工作区信息 + 挂载
 */
export default function App() {
  // ===== 工作区状态 =====
  const [workspaces, setWorkspaces] = useState([])
  const [workspace, setWorkspace] = useState('default')
  const [workspacePath, setWorkspacePath] = useState(null)

  // ===== 对话状态 =====
  const [conversations, setConversations] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [currentTitle, setCurrentTitle] = useState('')
  const [messages, setMessages] = useState([])

  // ===== 文件树状态 =====
  const [fileTree, setFileTree] = useState([])
  const [expandedDirs, setExpandedDirs] = useState(new Set())
  const [loadingDirs, setLoadingDirs] = useState(new Set())
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileContent, setFileContent] = useState('')

  // ===== 三栏拖拽宽度 =====
  const [filePanelWidth, setFilePanelWidth] = useState(240)
  const [chatWidth, setChatWidth] = useState(420)
  const dragRef = useRef(null)

  // ===== 弹窗状态 =====
  const [showMount, setShowMount] = useState(false)
  const [mountPath, setMountPath] = useState('')
  const [mounting, setMounting] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState(null)
  const [error, setError] = useState(null)

  // ===== 右键菜单 =====
  const [ctxMenu, setCtxMenu] = useState(null)
  const inputRef = useRef(null)

  // 构造 workspace 查询参数
  const workspaceQs = useCallback((extra = {}) => {
    const params = new URLSearchParams(extra)
    if (workspacePath) params.set('workspacePath', workspacePath)
    else params.set('workspace', workspace)
    return params.toString()
  }, [workspace, workspacePath])

  const selectWorkspace = (ws) => {
    if (ws.mounted) {
      setWorkspace(ws.name)
      setWorkspacePath(ws.root)
    } else {
      setWorkspace(ws.name)
      setWorkspacePath(null)
    }
  }

  // ===== 分栏拖拽 =====
  function startDrag(e, pane) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = pane === 'file' ? filePanelWidth : chatWidth
    const minWidth = pane === 'file' ? 180 : 280
    const maxWidth = pane === 'file' ? 400 : 900
    dragRef.current = { pane, startX, startWidth, minWidth, maxWidth }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current) return
      const { pane, startX, startWidth, minWidth, maxWidth } = dragRef.current
      const delta = pane === 'file' ? e.clientX - startX : startX - e.clientX
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

  // ===== 确认事件监听（由 ChatPanel 触发） =====
  useEffect(() => {
    const handler = (e) => setPendingConfirm(e.detail)
    window.addEventListener('workspace-confirm', handler)
    return () => window.removeEventListener('workspace-confirm', handler)
  }, [])

  // ===== 拉 workspace 列表 =====
  useEffect(() => {
    fetchJSON('/api/workspaces')
      .then(d => {
        const list = d.workspaces || []
        setWorkspaces(list)
        const currentKey = workspacePath || workspace
        const exists = list.some(w => (w.mounted ? w.root : w.name) === currentKey)
        if (!exists && list.length > 0) selectWorkspace(list[0])
      })
      .catch(e => setError(e.message))
  }, [])

  // ===== workspace 切换 =====
  useEffect(() => {
    setCurrentId(null)
    setMessages([])
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
      if (dirPath === '.') setFileTree(items)
      return items
    } catch (e) { setError(e.message); return [] }
  }

  // ===== 文件树交互 =====
  async function toggleDir(item) {
    const newExpanded = new Set(expandedDirs)
    if (newExpanded.has(item.path)) {
      newExpanded.delete(item.path)
      setExpandedDirs(newExpanded)
    } else {
      newExpanded.add(item.path)
      setExpandedDirs(newExpanded)
      if (!item.children) {
        setLoadingDirs(prev => new Set(prev).add(item.path))
        try {
          const children = await refreshFiles(item.path)
          setFileTree(prev => injectChildren(prev, item.path, children))
        } finally {
          setLoadingDirs(prev => { const s = new Set(prev); s.delete(item.path); return s })
        }
      }
    }
  }

  function injectChildren(tree, targetPath, children) {
    return tree.map(node => {
      if (node.path === targetPath) return { ...node, children, loaded: true }
      if (node.children) return { ...node, children: injectChildren(node.children, targetPath, children) }
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

  function closeCtxMenu() { setCtxMenu(null) }

  async function handleCopyPath() {
    if (!ctxMenu) return
    const absPath = getAbsPath(ctxMenu.item)
    try { await navigator.clipboard.writeText(absPath) }
    catch {
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
    try { await navigator.clipboard.writeText(ctxMenu.item.name) }
    catch {
      const tmp = document.createElement('input')
      tmp.value = ctxMenu.item.name
      document.body.appendChild(tmp)
      tmp.select()
      document.execCommand('copy')
      document.body.removeChild(tmp)
    }
    closeCtxMenu()
  }

  useEffect(() => {
    if (!ctxMenu) return
    const handler = () => closeCtxMenu()
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [ctxMenu])

  // ===== 拖拽文件到输入区 =====
  function handleDragStart(e, item) {
    const absPath = getAbsPath(item)
    e.dataTransfer.setData('text/plain', absPath)
    e.dataTransfer.effectAllowed = 'copy'
  }

  // ===== 挂载新目录 =====
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
    } catch (e) { setError(e.message) }
    finally { setMounting(false) }
  }

  // ===== 确认操作 =====
  async function handleConfirm(confirmed) {
    if (!pendingConfirm) return
    if (confirmed !== null) {
      try {
        await fetchJSON('/api/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmId: pendingConfirm.confirmId, confirmed })
        })
      } catch (e) { setError(e.message) }
    }
    setPendingConfirm(null)
  }

  // ===== 渲染 =====
  return (
    <div className="app">
      <Header
        workspaces={workspaces}
        workspace={workspace}
        workspacePath={workspacePath}
        onSelectWorkspace={selectWorkspace}
        onShowMount={() => setShowMount(true)}
      />

      <div className="main">
        {/* 左栏：文件树 */}
        <aside className="sidebar file-panel" style={{ width: filePanelWidth }}>
          <FileTree
            fileTree={fileTree}
            expandedDirs={expandedDirs}
            loadingDirs={loadingDirs}
            selectedFile={selectedFile}
            workspacePath={workspacePath}
            workspaceQs={workspaceQs}
            onFileClick={handleFileClick}
            onContextMenu={handleCtxMenu}
            onDragStart={handleDragStart}
            onRefresh={() => { setExpandedDirs(new Set()); refreshFiles('.') }}
            onError={setError}
          />
        </aside>

        <div className="resize-handle" onMouseDown={e => startDrag(e, 'file')} title="拖拽调整文件栏宽度" />

        {/* 中间：文件内容 */}
        <section className="content-area">
          <FileViewer
            selectedFile={selectedFile}
            fileContent={fileContent}
            onClose={() => { setSelectedFile(null); setFileContent('') }}
          />
        </section>

        <div className="resize-handle" onMouseDown={e => startDrag(e, 'chat')} title="拖拽调整聊天栏宽度" />

        {/* 右栏：对话 */}
        <section className="chat-area" style={{ width: chatWidth }}>
          <ChatPanel
            conversations={conversations}
            currentId={currentId}
            currentTitle={currentTitle}
            workspace={workspace}
            workspacePath={workspacePath}
            workspaceQs={workspaceQs}
            onSetCurrentId={setCurrentId}
            onSetCurrentTitle={setCurrentTitle}
            onSetMessages={setMessages}
            messages={messages}
            onError={setError}
            onRefreshConversations={refreshConversations}
            onRefreshFiles={() => refreshFiles('.')}
            inputRef={inputRef}
          />
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
              <button className="btn-allow" onClick={handleMount} disabled={mounting || !mountPath.trim()}>
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
      <ConfirmDialog pendingConfirm={pendingConfirm} onConfirm={handleConfirm} />

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
