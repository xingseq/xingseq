import React, { useState } from 'react'

/**
 * 子应用管理面板
 *
 * 展示网关发现的全部子应用卡片：名称、描述、UI 端口、运行状态；
 * 提供「启动 / 打开 / 停止」操作，分别调用网关的 start / 切 iframe / stop。
 *
 * @param {object}   props
 * @param {Array}    props.apps      子应用清单（来自 /console/api/apps）
 * @param {Function} props.onRefresh 刷新清单
 * @param {Function} props.onOpen    打开某个子应用（切到 iframe）
 */
export default function SubAppManager({ apps = [], onRefresh, onOpen }) {
  const [busy, setBusy] = useState(null)   // 正在操作的 app name
  const [error, setError] = useState(null)

  async function start(app) {
    setBusy(app.name); setError(null)
    try {
      const res = await fetch(`/console/api/apps/${encodeURIComponent(app.name)}/start`, { method: 'POST' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || '启动失败')
      await onRefresh?.()
    } catch (e) {
      setError(`启动 ${app.name} 失败：${e.message}`)
    } finally { setBusy(null) }
  }

  async function stop(app) {
    setBusy(app.name); setError(null)
    try {
      const res = await fetch(`/console/api/apps/${encodeURIComponent(app.name)}/stop`, { method: 'POST' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || '停止失败')
      await onRefresh?.()
    } catch (e) {
      setError(`停止 ${app.name} 失败：${e.message}`)
    } finally { setBusy(null) }
  }

  return (
    <div className="subapp-manager">
      <div className="subapp-header">
        <h2>子应用管理</h2>
        <button className="btn-secondary" onClick={() => onRefresh?.()}>刷新</button>
      </div>

      {error && <div className="console-error" onClick={() => setError(null)}>{error} （点击关闭）</div>}

      <div className="subapp-grid">
        {apps.map(app => {
          const hasUi = app.ui && app.ui.enabled !== false && app.ui.port
          const isBusy = busy === app.name
          return (
            <div className="subapp-card" key={app.name}>
              <div className="subapp-card-head">
                <span className="subapp-title">{app.displayName || app.name}</span>
                <span className={`subapp-status ${app.running ? 'on' : 'off'}`}>
                  {app.running ? '运行中' : '未启动'}
                </span>
              </div>
              <div className="subapp-desc">{app.description || '—'}</div>
              <div className="subapp-meta">
                <span>name: {app.name}</span>
                {hasUi
                  ? <span>UI: :{app.ui.port}</span>
                  : <span className="subapp-noui">无 UI</span>}
                {app.cli && <span>CLI ✓</span>}
              </div>
              <div className="subapp-actions">
                {hasUi && (
                  <button className="btn-primary" disabled={isBusy} onClick={() => onOpen?.(app)}>
                    打开
                  </button>
                )}
                {app.running
                  ? <button className="btn-danger" disabled={isBusy} onClick={() => stop(app)}>
                      {isBusy ? '处理中…' : '停止'}
                    </button>
                  : <button className="btn-secondary" disabled={isBusy || !hasUi} onClick={() => start(app)}>
                      {isBusy ? '启动中…' : '启动'}
                    </button>}
              </div>
            </div>
          )
        })}
        {apps.length === 0 && <div className="subapp-empty">未发现任何子应用（检查 apps/ 下的 sub-app-manifest.json）</div>}
      </div>
    </div>
  )
}
