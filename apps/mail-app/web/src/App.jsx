import { useState, useEffect, useRef, useCallback } from 'react'

const MODE_LABEL = { live: '真实邮箱', mock: '虚拟邮箱', dry: '离线测试' }

const EMPTY_CFG_FORM = {
  email: '', senderFilter: '', pollInterval: 60000,
  imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 465, password: ''
}

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
  const [cfgForm, setCfgForm] = useState(EMPTY_CFG_FORM)
  const [cfgInfo, setCfgInfo] = useState(null)   // { passwordSet, configPath }
  const [cfgMsg, setCfgMsg] = useState('')
  const [saving, setSaving] = useState(false)
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

  // 邮箱配置：只拉取非敏感字段（后端永不回传密码），保留用户已输入未保存的密码
  const refreshConfig = useCallback(() => {
    api('/api/mail-config').then(d => {
      setCfgInfo({ passwordSet: d.passwordSet, configPath: d.configPath })
      setCfgForm(f => ({
        email: d.email || '',
        senderFilter: d.senderFilter || '',
        pollInterval: d.pollInterval || 60000,
        imapHost: d.imapHost || '',
        imapPort: d.imapPort || 993,
        smtpHost: d.smtpHost || '',
        smtpPort: d.smtpPort || 465,
        password: f.password || ''
      }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    refreshHealth()
    refreshProjects()
    refreshLogs()
    refreshConfig()
    const t1 = setInterval(refreshHealth, 5000)
    const t3 = setInterval(() => { if (autoLog) refreshLogs() }, 10000)
    return () => { clearInterval(t1); clearInterval(t3) }
  }, [refreshHealth, refreshProjects, refreshLogs, refreshConfig, autoLog])

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

  const saveConfig = async (e) => {
    e.preventDefault()
    setError(''); setCfgMsg('')
    setSaving(true)
    try {
      const payload = {
        email: cfgForm.email,
        senderFilter: cfgForm.senderFilter,
        pollInterval: cfgForm.pollInterval,
        imapHost: cfgForm.imapHost,
        imapPort: cfgForm.imapPort,
        smtpHost: cfgForm.smtpHost,
        smtpPort: cfgForm.smtpPort
      }
      if (cfgForm.password) payload.password = cfgForm.password
      const d = await api('/api/mail-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      setCfgForm(f => ({ ...f, password: '' }))
      setCfgMsg(d.deferred ? '已保存，将在当前邮件处理完后生效' : '已保存并热重载生效 ✓')
      refreshHealth(); refreshConfig()
    } catch (err) { showError(err) }
    finally { setSaving(false) }
  }

  const monitorOk = health?.monitorRunning
  const imapOk = health?.imapConnected
  // 进程存活但 IMAP 未连接 = 「假死」：健康检查曾误报正常，这里显式区分三态
  const zombie = monitorOk && !imapOk
  const chipClass = (monitorOk && imapOk) ? 'ok' : zombie ? 'warn' : 'bad'
  const chipText = (monitorOk && imapOk) ? '监听运行中' : zombie ? '进程存活·邮箱未连接' : '监听已停止'

  return (
    <div className="app">
      <header className="header">
        <h1>📧 邮件网关管理</h1>
        <div className={`status-chip ${chipClass}`}>
          {chipText}
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
              <li>
                <span>邮箱连接</span>
                <b className={imapOk ? 'text-ok' : 'text-bad'}>
                  {health.mode === 'live'
                    ? (imapOk ? '已连接' : `未连接（${health.imapState}）`)
                    : '虚拟邮箱'}
                </b>
              </li>
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

      {/* === 邮箱配置卡片 === */}
      <section className="card config-card">
        <h2>
          邮箱配置
          <span className="muted small">（保存即热重载生效，无需重启网关）</span>
        </h2>
        {cfgMsg && <div className="cfg-msg" onClick={() => setCfgMsg('')}>{cfgMsg}（点击关闭）</div>}
        <form className="cfg-form" onSubmit={saveConfig}>
          <label className="cfg-field span2">
            <span>监听邮箱</span>
            <input
              type="email" value={cfgForm.email} required placeholder="assistant@qq.com"
              onChange={e => setCfgForm({ ...cfgForm, email: e.target.value.trim() })}
            />
          </label>
          <label className="cfg-field span2">
            <span>邮箱授权码 / 密码</span>
            <input
              type="password" value={cfgForm.password} autoComplete="new-password"
              placeholder={cfgInfo?.passwordSet ? '已配置 ✓（留空则不修改）' : '请填写 IMAP/SMTP 授权码'}
              onChange={e => setCfgForm({ ...cfgForm, password: e.target.value })}
            />
          </label>
          <label className="cfg-field span2">
            <span>接受发件人（精确匹配，留空 = 所有人）</span>
            <input
              type="text" value={cfgForm.senderFilter} placeholder="boss@example.com"
              onChange={e => setCfgForm({ ...cfgForm, senderFilter: e.target.value.trim() })}
            />
          </label>
          <label className="cfg-field">
            <span>轮询间隔（秒）</span>
            <input
              type="number" min="1" value={Math.round(cfgForm.pollInterval / 1000)}
              onChange={e => setCfgForm({ ...cfgForm, pollInterval: (Number(e.target.value) || 0) * 1000 })}
            />
          </label>
          <div className="cfg-field">
            <span>IMAP（收信）</span>
            <div className="cfg-row">
              <input
                className="cfg-host" type="text" value={cfgForm.imapHost} placeholder="imap.qq.com"
                onChange={e => setCfgForm({ ...cfgForm, imapHost: e.target.value.trim() })}
              />
              <input
                className="cfg-port" type="number" min="1" max="65535" value={cfgForm.imapPort}
                onChange={e => setCfgForm({ ...cfgForm, imapPort: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="cfg-field">
            <span>SMTP（发信）</span>
            <div className="cfg-row">
              <input
                className="cfg-host" type="text" value={cfgForm.smtpHost} placeholder="smtp.qq.com"
                onChange={e => setCfgForm({ ...cfgForm, smtpHost: e.target.value.trim() })}
              />
              <input
                className="cfg-port" type="number" min="1" max="65535" value={cfgForm.smtpPort}
                onChange={e => setCfgForm({ ...cfgForm, smtpPort: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="cfg-actions span2">
            <button type="submit" className="btn primary" disabled={saving}>{saving ? '保存中…' : '保存并生效'}</button>
          </div>
        </form>
        <p className="muted small">
          配置写入 {cfgInfo?.configPath || '~/.xingseq/mail-app/config/mail.json'}（权限 0600）。授权码只写入、不回显。
        </p>
      </section>

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
