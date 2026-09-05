import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'

/**
 * 子应用管理面板
 *
 * 展示网关发现的全部子应用卡片：名称、描述、UI 端口、运行状态；
 * 提供「启动 / 打开 / 停止」操作，分别调用网关的 start / 切 iframe / stop。
 * 面板标题由外层顶栏提供，「刷新」按钮 portal 到顶栏插槽。
 *
 * @param {object}   props
 * @param {Array}    props.apps      子应用清单（来自 /console/api/apps）
 * @param {Function} props.onRefresh 刷新清单
 * @param {Function} props.onOpen    打开某个子应用（切到 iframe）
 * @param {?Element} props.toolbarEl 顶栏操作区 DOM（用于 portal）
 */
export default function SubAppManager({ apps = [], onRefresh, onOpen, toolbarEl }) {
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
    <div className="panel">
      {toolbarEl && createPortal(
        <button className="icon-btn" title="刷新清单" onClick={() => onRefresh?.()}>
          <Icon name="refresh" size={16} />
        </button>,
        toolbarEl
      )}

      {error && (
        <div className="banner banner-error" onClick={() => setError(null)}>
          <Icon name="alert" size={15} />
          <span>{error}</span>
          <Icon name="close" size={14} className="banner-close" />
        </div>
      )}

      <div className="card-grid">
        {apps.map(app => {
          const hasUi = app.ui && app.ui.enabled !== false && app.ui.port
          const hasApi = app.api && app.api.enabled !== false && app.api.port
          const isBusy = busy === app.name
          return (
            <div className="card" key={app.name}>
              <div className="card-head">
                <span className="card-title">{app.displayName || app.name}</span>
                <span className={`pill ${app.running ? 'on' : 'off'}`}>
                  {app.running ? '运行中' : '未启动'}
                </span>
              </div>
              <div className="card-desc">{app.description || '—'}</div>
              <div className="card-meta">
                <span className="mono">{app.name}</span>
                {hasUi
                  ? <span className="mono">UI :{app.ui.port}</span>
                  : <span className="meta-warn">无 UI</span>}
                {hasApi && <span className="mono">API :{app.api.port}</span>}
                {app.cli && <span>CLI</span>}
              </div>
              <div className="card-actions">
                {hasUi && (
                  <button className="btn btn-primary" disabled={isBusy} onClick={() => onOpen?.(app)}>
                    打开
                  </button>
                )}
                {app.running
                  ? <button className="btn btn-danger" disabled={isBusy} onClick={() => stop(app)}>
                      {isBusy ? '处理中…' : '停止'}
                    </button>
                  : <button className="btn btn-secondary" disabled={isBusy || (!hasUi && !hasApi)} onClick={() => start(app)}>
                      {isBusy ? '启动中…' : '启动'}
                    </button>}
              </div>
            </div>
          )
        })}
        {apps.length === 0 && <div className="empty-note">未发现任何子应用（检查 apps/ 下的 sub-app-manifest.json）</div>}
      </div>
    </div>
  )
}
