import React from 'react'

/**
 * 顶栏：应用标题 + 工作区选择 + 挂载按钮
 */
export default function Header({ workspaces, workspace, workspacePath, onSelectWorkspace, onShowMount }) {
  return (
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
              if (selected) onSelectWorkspace(selected)
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
        <button className="btn-mount" onClick={onShowMount} title="挂载本地目录">
          + 挂载
        </button>
      </div>
    </header>
  )
}
