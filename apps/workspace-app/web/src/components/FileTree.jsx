import React, { useState } from 'react'
import { fetchJSON } from '../sseClient.js'

/** 递归目录树节点 */
function TreeNode({ item, depth, expandedDirs, loadingDirs, selectedFile, onClick, onContextMenu, onDragStart }) {
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

/**
 * 文件树面板（含搜索框）
 */
export default function FileTree({
  fileTree,
  expandedDirs,
  loadingDirs,
  selectedFile,
  workspacePath,
  workspaceQs,
  onFileClick,
  onContextMenu,
  onDragStart,
  onRefresh,
  onError
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)

  async function handleSearch(q) {
    setSearchQuery(q)
    if (!q.trim()) {
      setSearchResults(null)
      return
    }
    if (q.trim().length < 2) return
    setSearching(true)
    try {
      const data = await fetchJSON(`/api/files/search?${workspaceQs({ q: q.trim() })}`)
      setSearchResults(data.results || [])
    } catch (e) {
      onError(e.message)
    } finally {
      setSearching(false)
    }
  }

  return (
    <>
      <div className="panel-header">
        <span>📂 文件</span>
        <button onClick={() => { setSearchQuery(''); setSearchResults(null); onRefresh() }} title="刷新">↻</button>
      </div>
      <div className="file-search">
        <input
          type="text"
          className="file-search-input"
          placeholder="搜索文件…"
          value={searchQuery}
          onChange={e => handleSearch(e.target.value)}
        />
        {searching && <span className="file-search-spinner">⋯</span>}
      </div>
      <div className="file-tree">
        {searchResults !== null ? (
          // 搜索结果模式
          searchResults.length === 0 ? (
            <div className="empty">未找到匹配文件</div>
          ) : (
            searchResults.map(item => (
              <div
                key={item.path}
                className={`file-item file${selectedFile?.path === item.path ? ' active' : ''}`}
                onClick={() => onFileClick(item)}
                onContextMenu={e => onContextMenu(e, item)}
                draggable
                onDragStart={e => onDragStart(e, item)}
                title={item.path}
              >
                <span className="file-icon">📄</span>
                <span className="file-name">{item.name}</span>
                <span className="file-search-path">{item.dir}</span>
              </div>
            ))
          )
        ) : (
          // 正常文件树模式
          <>
            {fileTree.length === 0 && <div className="empty">（空目录）</div>}
            {fileTree.map(item => (
              <TreeNode
                key={item.path}
                item={item}
                depth={0}
                expandedDirs={expandedDirs}
                loadingDirs={loadingDirs}
                selectedFile={selectedFile}
                onClick={onFileClick}
                onContextMenu={onContextMenu}
                onDragStart={onDragStart}
              />
            ))}
          </>
        )}
      </div>
    </>
  )
}
