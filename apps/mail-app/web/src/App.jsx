import { useState, useEffect, useRef, useCallback } from 'react'

const MODE_LABEL = { live: '真实邮箱', mock: '虚拟邮箱', dry: '离线测试' }

function fmtUptime(sec) {
  if (sec == null) return '-'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}天${h}小时`
  if (h > 0) return `${h}小时${m}分`
  return `${m}分${sec % 60}秒`
}

async function api(path, options) {
  const res = await fetch(path, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

export default function App() {
  const [health, setHealth] = useState(null)
  const [projects, setProjects] = useState(null)
  const [configPath, setConfigPath] = useState('')
  const [defaultProject, setDefaultProject] = useState(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', path: '', description: '' })
  const [logs, setLogs] = useState({ content: '', file: '' })
  const [autoLog, setAutoLog] = useState(true)
  const logRef = useRef(null)

  const showError = (e) => { setError(e.message || String(e)) }

  const refreshHealth = useCallback(() => {
    api('/api/health').then(setHealth).catch(() => {})
  }, [])

  const refreshProjects = useCallback(() => {
    api('/api/projects').then(d => {
      setProjects(d.projects)
      setConfigPath(d.configPath)
      setDefaultProject(d.defaultProject)
    }).catch(showError)
  }, [])

  const refreshLogs = useCallback(() => {
    api('/api/logs/tail?lines=200').then(setLogs).catch(() => {})
  }, [])

  useEffect(() => {
    refreshHealth()
    refreshProjects()
    refreshLogs()
    const t1 = setInterval(refreshHealth, 5000)
    const t3 = setInterval(() => { if (autoLog) refreshLogs() }, 10000)
    return () => { clearInterval(t1); clearInterval(t3) }
  }, [refreshHealth, refreshProjects, refreshLogs, autoLog])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const addProject = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const d = await api('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      setProjects(d.projects)
      setDefaultProject(d.defaultProject)
      setForm({ name: '', path: '', description: '' })
    } catch (err) { showError(err) }
  }

  const removeProject = async (name) => {
    if (!window.confirm(`确定移除项目「${name}」？邮件 AI 将无法再访问它。`)) return
    setError('')
    try {
      const d = await api(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' })
      setProjects(d.projects)
      setDefaultProject(d.defaultProject)
    } catch (err) { showError(err) }
  }

  const makeDefault = async (name) => {
    setError('')
    try {
      const d = await api('/api/projects/default', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      setProjects(d.projects)
      setDefaultProject(d.defaultProject)
    } catch (err) { showError(err) }
  }

  const monitorOk = health?.monitorRunning

  return (
    <div className="app">
      <header className="header">
        <h1>📧 邮件网关管理</h1>
        <div className={`status-chip ${monitorOk ? 'ok' : 'bad'}`}>
          {monitorOk ? '监听运行中' : '监听已停止'}
        </div>
      </header>

      {error && <div className="error-bar" onClick={() => setError('')}>{error}（点击关闭）</div>}

      <main className="main">
        {/* === 状态卡片 === */}
        <section className="card">
          <h2>网关状态</h2>
          {health ? (
            <ul className="kv-list">
              <li><span>模式</span><b>{MODE_LABEL[health.mode] || health.mode}</b></li>
              <li><span>监听邮箱</span><b>{health.email}</b></li>
              <li><span>接受发件人</span><b>{health.senderFilter}</b></li>
              <li><span>轮询间隔</span><b>{health.pollIntervalSec} 秒</b></li>
              <li><span>已处理邮件</span><b>{health.processedEmails} 封</b></li>
              <li><span>运行时长</span><b>{fmtUptime(health.uptimeSec)}</b></li>
              <li><span>进程 PID</span><b>{health.pid}</b></li>
            </ul>
          ) : <p className="muted">加载中…（网关未运行时此处为空）</p>}
          <p className="muted small">说明：邮件链路由 launchd 常驻服务承载，关闭本窗口不影响收发。</p>
        </section>

        {/* === 项目管理卡片 === */}
        <section className="card grow">
          <h2>
            Qoder 可访问项目
            <span className="muted small">（邮件里说「在 xx 项目里…」即路由到此清单）</span>
          </h2>
          <form className="add-form" onSubmit={addProject}>
            <input
              placeholder="项目名（如 aipet）" value={form.name} required
              pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*"
              title="字母/数字开头，可含 - 和 _"
              onChange={e => setForm({ ...form, name: e.target.value.trim() })}
            />
            <input
              placeholder="目录绝对路径（如 /Users/ws/Dev/aipet）" value={form.path} required
              className="path-input"
              onChange={e => setForm({ ...form, path: e.target.value.trim() })}
            />
            <input
              placeholder="描述（可选，帮 AI 理解项目用途）" value={form.description}
              className="desc-input"
              onChange={e => setForm({ ...form, description: e.target.value })}
            />
            <button type="submit" className="btn primary">登记</button>
          </form>

          {projects === null ? <p className="muted">加载中…</p> : projects.length === 0 ? (
            <p className="muted">（空）用上方表单登记第一个项目</p>
          ) : (
            <table className="proj-table">
              <thead>
                <tr><th>项目</th><th>路径</th><th>描述</th><th>操作</th></tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr key={p.name} className={!p.exists ? 'missing' : ''}>
                    <td>
                      {defaultProject === p.name && <span className="star" title="默认项目">★</span>}
                      <b>{p.name}</b>
                    </td>
                    <td className="path-cell">
                      {p.path}
                      {!p.exists && <span className="tag warn">目录不存在·已忽略</span>}
                    </td>
                    <td className="muted">{p.description || '-'}</td>
                    <td className="ops">
                      {defaultProject !== p.name && (
                        <button className="btn small" onClick={() => makeDefault(p.name)}>设为默认</button>
                      )}
                      <button className="btn small danger" onClick={() => removeProject(p.name)}>移除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {configPath && <p className="muted small">配置文件：{configPath}（即改即生效，无需重启）</p>}
        </section>
      </main>

      {/* === 日志卡片 === */}
      <section className="card log-card">
        <h2>
          网关日志（尾部 200 行）
          <label className="auto-toggle">
            <input type="checkbox" checked={autoLog} onChange={e => setAutoLog(e.target.checked)} />
            10 秒自动刷新
          </label>
          <button className="btn small" onClick={refreshLogs}>刷新</button>
        </h2>
        <pre ref={logRef} className="log-view">{logs.content || '（暂无日志）'}</pre>
        {logs.file && <p className="muted small">{logs.file}</p>}
      </section>
    </div>
  )
}
