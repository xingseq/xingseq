import React, { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 应用商店面板
 *
 * 浏览远程注册中心（xingseq-agent-hub）的可用子应用，支持：
 *   - 安装：GET /console/api/store/install/:name（SSE 实时进度）
 *   - 更新：GET /console/api/store/update/:name（SSE 实时进度）
 *   - 卸载：POST /console/api/store/uninstall/:name
 *
 * 数据来源：
 *   - GET /console/api/store/apps     远程+本地合并可用列表
 *   - GET /console/api/store/updates  可更新列表
 *
 * @param {object}   props
 * @param {Function} props.onInstalled 安装/更新/卸载成功后回调（用于刷新左侧子应用列表）
 */

// 状态徽章文案
const STATUS_LABEL = {
  installed: '已安装',
  available: '未安装',
  update: '有更新',
  error: '异常'
}

// SSE 消费：浏览器原生 EventSource 支持 GET，这里用 fetch + ReadableStream
// 复用 workspace-app sseClient 的解析逻辑，便于在卡片内追加进度日志。
async function streamSSE(url, onEvent, signal) {
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`请求失败 ${res.status}: ${text || res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      if (!raw.trim() || raw.startsWith(':')) continue

      let event = 'message'
      const dataLines = []
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (!dataLines.length) continue
      let data
      try { data = JSON.parse(dataLines.join('\n')) }
      catch { data = dataLines.join('\n') }

      onEvent({ event, data })
    }
  }
}

export default function AppStore({ onInstalled }) {
  const [apps, setApps] = useState([])
  const [updates, setUpdates] = useState({})   // name → { localVersion, remoteVersion }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)        // 正在安装/更新/卸载的 app name
  const [logs, setLogs] = useState({})          // name → [{ step, message }]
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/console/api/store/apps')
      const data = await res.json()
      setApps(data.apps || [])
      if (data.error) setError(`加载应用商店失败：${data.error}`)

      // 顺带拉取可更新列表（失败静默）
      try {
        const ur = await fetch('/console/api/store/updates')
        const ud = await ur.json()
        const map = {}
        for (const u of ud.updates || []) map[u.name] = u
        setUpdates(map)
      } catch { /* 忽略 */ }
    } catch (e) {
      setError(`加载应用商店失败：${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    return () => { abortRef.current?.abort() }
  }, [load])

  // 安装 / 更新（SSE）
  const runInstall = useCallback(async (app, action) => {
    setBusy(app.name); setError(null)
    setLogs(prev => ({ ...prev, [app.name]: [] }))
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const append = (entry) => {
      setLogs(prev => ({ ...prev, [app.name]: [...(prev[app.name] || []), entry] }))
    }

    try {
      const url = `/console/api/store/${action}/${encodeURIComponent(app.name)}`
      let finalResult = null
      await streamSSE(url, ({ event, data }) => {
        if (event === 'progress') {
          append({ step: data.step, message: data.message })
        } else if (event === 'done') {
          finalResult = data
        }
      }, ctrl.signal)

      if (finalResult && !finalResult.success) {
        throw new Error(finalResult.error || '安装失败')
      }
      append({ step: 'ok', message: action === 'update' ? '更新完成' : '安装完成' })
      await load()
      onInstalled?.()
    } catch (e) {
      if (e.name === 'AbortError') return
      setError(`${action === 'update' ? '更新' : '安装'} ${app.name} 失败：${e.message}`)
      append({ step: 'error', message: e.message })
    } finally {
      setBusy(null)
      abortRef.current = null
    }
  }, [load, onInstalled])

  // 卸载
  const uninstall = useCallback(async (app) => {
    if (!window.confirm(`确定卸载 ${app.displayName || app.name}？将删除本地文件。`)) return
    setBusy(app.name); setError(null)
    try {
      const res = await fetch(`/console/api/store/uninstall/${encodeURIComponent(app.name)}`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || '卸载失败')
      setLogs(prev => { const n = { ...prev }; delete n[app.name]; return n })
      await load()
      onInstalled?.()
    } catch (e) {
      setError(`卸载 ${app.name} 失败：${e.message}`)
    } finally {
      setBusy(null)
    }
  }, [load, onInstalled])

  return (
    <div className="subapp-manager">
      <div className="subapp-header">
        <h2>应用商店</h2>
        <button className="btn-secondary" disabled={loading || !!busy} onClick={load}>
          {loading ? '加载中…' : '刷新'}
        </button>
      </div>

      {error && <div className="console-error" onClick={() => setError(null)}>{error} （点击关闭）</div>}

      <div className="subapp-grid">
        {apps.map(app => {
          const hasUpdate = !!updates[app.name] || app.status === 'update'
          const isBusy = busy === app.name
          const installed = app.status === 'installed' || app.status === 'error'
          const badge = hasUpdate ? 'update' : app.status
          const appLogs = logs[app.name] || []
          return (
            <div className="subapp-card" key={app.name}>
              <div className="subapp-card-head">
                <span className="subapp-title">{app.displayName || app.name}</span>
                <span className={`store-badge ${badge}`}>
                  {hasUpdate ? '有更新' : (STATUS_LABEL[app.status] || app.status)}
                </span>
              </div>
              <div className="subapp-meta">
                <span>name: {app.name}</span>
                {app.repo && <span className="store-repo" title={app.repo}>{app.repo.replace('https://github.com/', '')}</span>}
                {app.localVersion && <span>v{app.localVersion}</span>}
              </div>

              {appLogs.length > 0 && (
                <div className="store-progress">
                  {appLogs.map((l, i) => {
                    const last = i === appLogs.length - 1
                    return (
                      <div
                        key={i}
                        className={`store-progress-line ${last && isBusy ? 'current' : ''} ${l.step === 'error' ? 'err' : ''}`}
                      >
                        <span className="store-progress-step">{l.step}</span>
                        <span>{l.message}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="subapp-actions">
                {!installed && (
                  <button className="btn-primary" disabled={isBusy} onClick={() => runInstall(app, 'install')}>
                    {isBusy ? '安装中…' : '安装'}
                  </button>
                )}
                {installed && hasUpdate && (
                  <button className="btn-primary" disabled={isBusy} onClick={() => runInstall(app, 'update')}>
                    {isBusy ? '更新中…' : '更新'}
                  </button>
                )}
                {installed && (
                  <button className="btn-danger" disabled={isBusy} onClick={() => uninstall(app)}>
                    {isBusy ? '处理中…' : '卸载'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {apps.length === 0 && !loading && (
          <div className="subapp-empty">应用商店为空（远程注册中心不可达或未配置）</div>
        )}
      </div>
    </div>
  )
}
