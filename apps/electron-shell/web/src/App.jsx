import React, { useCallback, useEffect, useState } from 'react'
import SubAppManager from './components/SubAppManager.jsx'
import AppStore from './components/AppStore.jsx'

/**
 * XingSeq 控制台前端
 *
 * 布局：左侧导航（子应用列表 + 子应用管理 + 应用商店）+ 右侧内容区。
 *   - 选中某个子应用 → 先经网关按需拉起其 server，再用 <iframe> 嵌入其端口。
 *   - 选中「子应用管理」→ 渲染 SubAppManager 面板。
 *   - 选中「应用商店」→ 渲染 AppStore 面板。
 *
 * 数据来源：控制台网关（electron-shell 主进程内的 http 服务）
 *   - GET  /console/api/apps            子应用清单 + 运行状态
 *   - POST /console/api/apps/:name/start 按需启动
 *   - POST /console/api/apps/:name/stop  停止
 *   - 应用商店相关端点见 AppStore.jsx
 */

const MANAGER_VIEW = '__manager__'
const STORE_VIEW = '__store__'

// 子应用图标（按 name 匹配，缺省用首字母）
const APP_ICONS = {
  'chat-app': '💬',
  'workspace-app': '📁',
  'llm-manager': '🤖',
  'mail-app': '✉️'
}

export default function App() {
  const [apps, setApps] = useState([])
  const [active, setActive] = useState(null)      // 选中的子应用 name，或 MANAGER_VIEW
  const [iframeSrc, setIframeSrc] = useState('')   // 当前 iframe 地址
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)

  const refreshApps = useCallback(async () => {
    try {
      const res = await fetch('/console/api/apps')
      const data = await res.json()
      setApps(data.apps || [])
      return data.apps || []
    } catch (e) {
      setError(`加载子应用清单失败：${e.message}`)
      return []
    }
  }, [])

  useEffect(() => { refreshApps() }, [refreshApps])

  // 打开一个带 UI 的子应用：按需启动 → 设置 iframe
  const openApp = useCallback(async (app) => {
    if (!app?.ui?.port) {
      setError(`${app.displayName || app.name} 未声明 UI 端口，无法在控制台打开`)
      return
    }
    setActive(app.name)
    setError(null)
    setStarting(true)
    setIframeSrc('')
    try {
      const res = await fetch(`/console/api/apps/${encodeURIComponent(app.name)}/start`, { method: 'POST' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || '启动失败')
      // iframe 直连子应用自身端口（同源相对 /api 可正常工作）
      setIframeSrc(`http://localhost:${data.port}/`)
      refreshApps()
    } catch (e) {
      setError(`启动 ${app.displayName || app.name} 失败：${e.message}`)
    } finally {
      setStarting(false)
    }
  }, [refreshApps])

  const openManager = () => {
    setActive(MANAGER_VIEW)
    setIframeSrc('')
    setError(null)
  }

  const openStore = () => {
    setActive(STORE_VIEW)
    setIframeSrc('')
    setError(null)
  }

  const uiApps = apps.filter(a => a.ui && a.ui.enabled !== false && a.ui.port)

  return (
    <div className="console">
      {/* 左侧导航 */}
      <aside className="nav">
        <div className="brand">
          <span className="brand-logo">✦</span>
          <span className="brand-name">XingSeq 控制台</span>
        </div>

        <div className="nav-section-title">子应用</div>
        <ul className="nav-list">
          {uiApps.map(app => (
            <li
              key={app.name}
              className={`nav-item ${active === app.name ? 'active' : ''}`}
              onClick={() => openApp(app)}
              title={app.description || app.name}
            >
              <span className="nav-icon">{APP_ICONS[app.name] || app.name[0]?.toUpperCase()}</span>
              <span className="nav-label">{app.displayName || app.name}</span>
              {app.running && <span className="nav-dot" title="运行中" />}
            </li>
          ))}
          {uiApps.length === 0 && (
            <li className="nav-empty">未发现可用子应用</li>
          )}
        </ul>

        <div className="nav-section-title">管理</div>
        <ul className="nav-list">
          <li
            className={`nav-item ${active === MANAGER_VIEW ? 'active' : ''}`}
            onClick={openManager}
          >
            <span className="nav-icon">🧩</span>
            <span className="nav-label">子应用管理</span>
          </li>
          <li
            className={`nav-item ${active === STORE_VIEW ? 'active' : ''}`}
            onClick={openStore}
          >
            <span className="nav-icon">🛒</span>
            <span className="nav-label">应用商店</span>
          </li>
        </ul>
      </aside>

      {/* 右侧内容区 */}
      <main className="content">
        {error && <div className="console-error" onClick={() => setError(null)}>{error} （点击关闭）</div>}

        {active === MANAGER_VIEW && (
          <SubAppManager
            apps={apps}
            onRefresh={refreshApps}
            onOpen={openApp}
          />
        )}

        {active === STORE_VIEW && (
          <AppStore onInstalled={refreshApps} />
        )}

        {active && active !== MANAGER_VIEW && active !== STORE_VIEW && (
          <div className="iframe-host">
            {starting && <div className="iframe-loading">正在启动子应用…</div>}
            {iframeSrc && (
              <iframe
                title={active}
                src={iframeSrc}
                className="app-iframe"
                allow="clipboard-read; clipboard-write"
              />
            )}
          </div>
        )}

        {!active && (
          <div className="welcome">
            <h1>XingSeq 控制台</h1>
            <p>从左侧选择一个子应用打开，或进入「子应用管理」查看全部。</p>
          </div>
        )}
      </main>
    </div>
  )
}
