import React, { useCallback, useEffect, useMemo, useState } from 'react'
import SubAppManager from './components/SubAppManager.jsx'
import AppStore from './components/AppStore.jsx'
import Settings from './components/Settings.jsx'
import Icon from './components/Icon.jsx'

/**
 * XingSeq 控制台前端
 *
 * 布局（三段式）：
 *   1. 左侧栏：品牌 + 子应用列表 + 管理入口 + 底部运行态；可折叠为图标条。
 *      macOS 下顶部留出红绿灯占位区，整块作为窗口拖拽区。
 *   2. 内容顶栏：当前视图标题/副标题 + 上下文操作（重载 / 浏览器打开 / 停止）。
 *      面板类视图（管理、商店）通过 toolbarEl 插槽把自己的按钮挂到这里。
 *   3. 内容体：iframe 宿主 或 面板。
 *
 * 交互：
 *   - 选中某个子应用 → 先经网关按需拉起其 server，再用 <iframe> 嵌入其端口。
 *   - 选中「子应用管理」→ 渲染 SubAppManager 面板。
 *   - 选中「应用商店」→ 渲染 AppStore 面板。
 *   - 选中「设置」→ 渲染 Settings 面板。
 *
 * 数据来源：控制台网关（electron-shell 主进程内的 http 服务）
 *   - GET  /console/api/apps             子应用清单 + 运行状态
 *   - POST /console/api/apps/:name/start 按需启动
 *   - POST /console/api/apps/:name/stop  停止
 *   - 应用商店相关端点见 AppStore.jsx
 */

const MANAGER_VIEW = '__manager__'
const STORE_VIEW = '__store__'
const SETTINGS_VIEW = '__settings__'
const COLLAPSE_KEY = 'xingseq.console.sidebarCollapsed'

// 子应用图标（按 name 匹配，缺省用通用 grid）
const APP_ICONS = {
  'chat-app': 'chat',
  'workspace-app': 'folder',
  'llm-manager': 'bot',
  'mail-app': 'mail'
}
const iconOf = (name) => APP_ICONS[name] || 'grid'

export default function App() {
  const [apps, setApps] = useState([])
  const [active, setActive] = useState(null)      // 选中的子应用 name，或 MANAGER_VIEW / STORE_VIEW
  const [iframeSrc, setIframeSrc] = useState('')   // 当前 iframe 地址
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)    // 递增以强制重载 iframe
  const [toolbarEl, setToolbarEl] = useState(null) // 顶栏插槽 DOM，供面板 portal 挂按钮
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === '1'
  )

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

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

  // 停止当前 iframe 中的子应用，并退回欢迎页
  const stopActive = useCallback(async (name) => {
    setStopping(true); setError(null)
    try {
      const res = await fetch(`/console/api/apps/${encodeURIComponent(name)}/stop`, { method: 'POST' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || '停止失败')
      setIframeSrc('')
      setActive(null)
      await refreshApps()
    } catch (e) {
      setError(`停止 ${name} 失败：${e.message}`)
    } finally {
      setStopping(false)
    }
  }, [refreshApps])

  const openInBrowser = useCallback(() => {
    if (!iframeSrc) return
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(iframeSrc)
    else window.open(iframeSrc, '_blank')
  }, [iframeSrc])

  const openManager = () => { setActive(MANAGER_VIEW); setIframeSrc(''); setError(null) }
  const openStore = () => { setActive(STORE_VIEW); setIframeSrc(''); setError(null) }
  const openSettings = () => { setActive(SETTINGS_VIEW); setIframeSrc(''); setError(null) }

  const uiApps = useMemo(
    () => apps.filter(a => a.ui && a.ui.enabled !== false && a.ui.port),
    [apps]
  )
  const runningCount = useMemo(() => apps.filter(a => a.running).length, [apps])
  const activeApp = useMemo(() => apps.find(a => a.name === active) || null, [apps, active])

  const isPanel = active === MANAGER_VIEW || active === STORE_VIEW || active === SETTINGS_VIEW
  const isAppView = !!active && !isPanel

  // 顶栏标题：随当前视图变化
  const { title, subtitle } = useMemo(() => {
    if (active === MANAGER_VIEW) return { title: '子应用管理', subtitle: `${apps.length} 个子应用` }
    if (active === STORE_VIEW) return { title: '应用商店', subtitle: '安装、更新与商店源' }
    if (active === SETTINGS_VIEW) return { title: '设置', subtitle: '控制台偏好、子应用自启与环境变量' }
    if (activeApp) {
      return {
        title: activeApp.displayName || activeApp.name,
        subtitle: activeApp.ui?.port ? `localhost:${activeApp.ui.port}` : null
      }
    }
    return { title: 'XingSeq 控制台', subtitle: null }
  }, [active, activeApp, apps.length])

  const navItem = (key, iconName, label, onClick, running) => (
    <li key={key}>
      <button
        className={`nav-item ${active === key ? 'active' : ''}`}
        onClick={onClick}
        title={collapsed ? label : undefined}
      >
        <Icon name={iconName} size={16} className="nav-icon" />
        <span className="nav-label">{label}</span>
        {running && <span className="nav-dot" title="运行中" />}
      </button>
    </li>
  )

  return (
    <div className={`console ${collapsed ? 'nav-collapsed' : ''}`}>
      {/* ── 左侧栏 ─────────────────────────────── */}
      <aside className="sidebar">
        {/* 顶部：红绿灯让位 + 窗口拖拽区，品牌名贴在红绿灯右侧 */}
        <div className="sidebar-titlebar">
          <div className="brand" title="XingSeq 控制台">
            <Icon name="sparkle" size={14} className="brand-logo" />
            <span className="brand-name">XingSeq</span>
          </div>
        </div>

        <nav className="nav-scroll">
          <div className="nav-section-title">子应用</div>
          <ul className="nav-list">
            {uiApps.map(app => navItem(
              app.name,
              iconOf(app.name),
              app.displayName || app.name,
              () => openApp(app),
              app.running
            ))}
            {uiApps.length === 0 && <li className="nav-empty">未发现可用子应用</li>}
          </ul>

          <div className="nav-section-title">管理</div>
          <ul className="nav-list">
            {navItem(MANAGER_VIEW, 'layers', '子应用管理', openManager)}
            {navItem(STORE_VIEW, 'store', '应用商店', openStore)}
            {navItem(SETTINGS_VIEW, 'settings', '设置', openSettings)}
          </ul>
        </nav>

        <div className="sidebar-footer" title={`${runningCount} 个子应用运行中`}>
          <span className={`footer-dot ${runningCount ? 'on' : ''}`} />
          <span className="footer-text">{runningCount} 个运行中</span>
        </div>
      </aside>

      {/* ── 右侧：顶栏 + 内容体 ─────────────────── */}
      <div className="main">
        <header className="topbar">
          <button
            className="icon-btn"
            onClick={() => setCollapsed(v => !v)}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            <Icon name="sidebar" size={17} />
          </button>

          <div className="topbar-title">
            <span className="topbar-title-main">{title}</span>
            {subtitle && <span className="topbar-title-sub">{subtitle}</span>}
          </div>

          {/* 面板视图的按钮通过 portal 挂到这里 */}
          <div className="topbar-slot" ref={setToolbarEl} />

          {/* 子应用视图的上下文操作 */}
          {isAppView && (
            <div className="topbar-actions">
              <button
                className="icon-btn"
                title="重新加载"
                disabled={!iframeSrc}
                onClick={() => setReloadKey(k => k + 1)}
              >
                <Icon name="refresh" size={16} />
              </button>
              <button
                className="icon-btn"
                title="在浏览器中打开"
                disabled={!iframeSrc}
                onClick={openInBrowser}
              >
                <Icon name="external" size={16} />
              </button>
              <button
                className="icon-btn danger"
                title="停止该子应用"
                disabled={stopping || !activeApp?.running}
                onClick={() => stopActive(active)}
              >
                <Icon name="stop" size={16} />
              </button>
            </div>
          )}
        </header>

        <main className="content">
          {error && (
            <div className="banner banner-error" onClick={() => setError(null)}>
              <Icon name="alert" size={15} />
              <span>{error}</span>
              <Icon name="close" size={14} className="banner-close" />
            </div>
          )}

          {active === MANAGER_VIEW && (
            <SubAppManager
              apps={apps}
              onRefresh={refreshApps}
              onOpen={openApp}
              toolbarEl={toolbarEl}
            />
          )}

          {active === STORE_VIEW && (
            <AppStore onInstalled={refreshApps} toolbarEl={toolbarEl} />
          )}

          {active === SETTINGS_VIEW && (
            <Settings apps={apps} onRefresh={refreshApps} toolbarEl={toolbarEl} />
          )}

          {isAppView && (
            <div className="iframe-host">
              {starting && (
                <div className="iframe-loading">
                  <span className="spinner" />
                  <span>正在启动 {title}…</span>
                </div>
              )}
              {iframeSrc && (
                <iframe
                  key={`${active}-${reloadKey}`}
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
              <Icon name="sparkle" size={40} className="welcome-logo" />
              <h1>XingSeq 控制台</h1>
              <p className="welcome-sub">选择一个子应用开始，或到「应用商店」安装更多。</p>

              {uiApps.length > 0 && (
                <div className="launch-grid">
                  {uiApps.map(app => (
                    <button className="launch-tile" key={app.name} onClick={() => openApp(app)}>
                      <Icon name={iconOf(app.name)} size={22} className="launch-icon" />
                      <span className="launch-name">{app.displayName || app.name}</span>
                      <span className={`launch-state ${app.running ? 'on' : ''}`}>
                        {app.running ? '运行中' : `:${app.ui.port}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
