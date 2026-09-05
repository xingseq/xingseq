import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'

/**
 * 设置面板
 *
 * 四组设置，读写网关的 /console/api/settings（落盘 ~/.xingseq/config/console.json）：
 *   1. 通用：开机自启 / 窗口记忆 / 控制台端口
 *   2. 子应用自启：壳层 override（商店更新不丢），与 manifest 默认一致时不落盘
 *   3. 环境变量：代理与路径键白名单，注入子应用进程（shell 环境变量优先）
 *   4. 关于/诊断：版本、配置与安装目录、重启控制台
 *
 * 交互约定：
 *   - 开关类（toggle）即时保存；文本输入（env / 端口）走底部「保存」统一提交
 *   - env 与端口改动只在下次启动读取，保存后提示需重启（提供一键重启）
 *
 * @param {object}   props
 * @param {Array}    props.apps      子应用清单（来自 /console/api/apps，含 autoStart 字段）
 * @param {Function} props.onRefresh 刷新子应用清单（autoStart 变化后调用）
 * @param {?Element} props.toolbarEl 顶栏操作区 DOM（「重载」按钮 portal 到这里）
 */

// 环境变量的分组与展示文案（与主进程 ENV_KEYS 白名单对应）
const ENV_GROUPS = [
  {
    title: '网络代理',
    hint: '子应用对外请求使用的代理，留空即不设置。',
    keys: ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY']
  },
  {
    title: '路径覆盖',
    hint: '各子应用的数据 / 工作区目录，留空使用各自默认值。',
    keys: ['NAJIE_USER_DATA_PATH', 'CHAT_APP_WORKSPACE', 'WORKSPACE_APP_PATH', 'WORKSPACE_APP_WORKSPACE']
  }
]

const ENV_LABELS = {
  HTTPS_PROXY: 'HTTPS 代理',
  HTTP_PROXY: 'HTTP 代理',
  ALL_PROXY: '全局代理',
  NO_PROXY: '代理排除列表',
  NAJIE_USER_DATA_PATH: '用户数据根目录',
  CHAT_APP_WORKSPACE: 'chat-app 挂载工作区',
  WORKSPACE_APP_PATH: 'workspace-app 挂载路径',
  WORKSPACE_APP_WORKSPACE: 'workspace-app 工作区名称'
}

const ENV_PLACEHOLDERS = {
  HTTPS_PROXY: 'http://127.0.0.1:7890',
  HTTP_PROXY: 'http://127.0.0.1:7890',
  ALL_PROXY: 'socks5://127.0.0.1:7890',
  NO_PROXY: 'localhost,127.0.0.1',
  NAJIE_USER_DATA_PATH: '~/.xingseq'
}

/** macOS 风格开关 */
function Toggle({ checked, disabled, title, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  )
}

export default function Settings({ apps = [], onRefresh, toolbarEl }) {
  const [data, setData] = useState(null)          // GET /console/api/settings 结果
  const [envDraft, setEnvDraft] = useState({})    // 编辑中的 env 值
  const [portDraft, setPortDraft] = useState('')  // 编辑中的控制台端口
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)      // 成功提示（含「需重启」标注）

  const load = useCallback(async () => {
    try {
      const res = await fetch('/console/api/settings')
      const body = await res.json()
      setData(body)
      const draft = {}
      for (const k of body.meta.envKeys || []) draft[k.key] = k.value || ''
      setEnvDraft(draft)
      setPortDraft(body.settings.general.consolePort ?? '')
    } catch (e) {
      setError(`加载设置失败：${e.message}`)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const settings = data?.settings
  const meta = data?.meta

  // env / 端口是否有未保存改动
  const dirty = useMemo(() => {
    if (!settings) return false
    const portChanged = (portDraft || null) !== (settings.general.consolePort ?? null)
    const envChanged = (meta.envKeys || []).some(k => (envDraft[k.key] || '') !== (k.value || ''))
    return portChanged || envChanged
  }, [settings, meta, envDraft, portDraft])

  /** 分组局部提交；成功后回读并按需刷新子应用清单 */
  async function put(body, { refresh = false } = {}) {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fetch('/console/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error || '保存失败')
      await load()
      if (refresh) await onRefresh?.()
      return result
    } catch (e) {
      setError(`保存设置失败：${e.message}`)
      return null
    } finally {
      setBusy(false)
    }
  }

  // ── 开关类：即时保存 ──────────────────────────────

  async function toggleRememberWindow(next) {
    await put({ general: { rememberWindow: next } })
  }

  async function toggleOpenAtLogin(next) {
    await put({ general: { openAtLogin: next } })
  }

  async function toggleAutoStart(app, next) {
    const overrides = { ...(settings?.autoStart || {}) }
    overrides[app.name] = next
    await put({ autoStart: overrides }, { refresh: true })
  }

  async function resetAutoStart(app) {
    const overrides = { ...(settings?.autoStart || {}) }
    delete overrides[app.name]
    await put({ autoStart: overrides }, { refresh: true })
  }

  // ── 文本输入类：底部统一保存 ──────────────────────

  async function saveEdits() {
    const port = portDraft.trim()
    if (port !== '' && !/^\d+$/.test(port)) {
      setError('控制台端口须为数字')
      return
    }
    const p = port === '' ? null : parseInt(port, 10)
    if (p !== null && (p < 1024 || p > 65535)) {
      setError('控制台端口须在 1024-65535 之间')
      return
    }
    const result = await put({ general: { consolePort: p }, env: envDraft })
    if (result) {
      setNotice(result.needsRestart
        ? '已保存。环境变量与端口在下次启动时生效，可点「重启控制台」立即应用。'
        : '已保存。')
    }
  }

  // ── 诊断动作 ──────────────────────────────────────

  async function openPath(target) {
    try {
      const res = await fetch('/console/api/settings/open-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target })
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error || '打开失败')
    } catch (e) {
      setError(`打开目录失败：${e.message}`)
    }
  }

  async function restartConsole() {
    if (!window.confirm('重启控制台？运行中的子应用会被一并停止再拉起。')) return
    try {
      await fetch('/console/api/settings/restart', { method: 'POST' })
      setNotice('正在重启…')
    } catch (e) {
      setError(`重启失败：${e.message}`)
    }
  }

  if (!settings || !meta) {
    return (
      <div className="panel">
        {error
          ? <div className="empty-note">{error}</div>
          : <div className="empty-note">加载设置中…</div>}
      </div>
    )
  }

  const envKeyMap = {}
  for (const k of meta.envKeys || []) envKeyMap[k.key] = k

  return (
    <div className="panel settings-panel">
      {toolbarEl && createPortal(
        <button className="icon-btn" title="重新加载设置" onClick={() => load()}>
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
      {notice && (
        <div className="banner banner-info" onClick={() => setNotice(null)}>
          <Icon name="info" size={15} />
          <span>{notice}</span>
          <Icon name="close" size={14} className="banner-close" />
        </div>
      )}

      {/* ── 通用 ─────────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-title">通用</div>

        <div className="settings-row">
          <div className="settings-row-main">
            <div className="settings-label">记住窗口位置与大小</div>
            <div className="settings-hint">关闭控制台时记住窗口状态，下次启动恢复</div>
          </div>
          <Toggle
            checked={settings.general.rememberWindow !== false}
            disabled={busy}
            onChange={toggleRememberWindow}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row-main">
            <div className="settings-label">登录时自动启动</div>
            <div className="settings-hint">
              {meta.isPackaged ? '通过系统登录项注册' : '开发模式不可用，仅打包版支持'}
            </div>
          </div>
          <Toggle
            checked={!!settings.general.openAtLogin}
            disabled={busy || !meta.isPackaged}
            title={meta.isPackaged ? undefined : '仅打包版支持'}
            onChange={toggleOpenAtLogin}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row-main">
            <div className="settings-label">控制台端口</div>
            <div className="settings-hint">留空使用默认 5180；当前运行端口 {meta.consolePort}。修改后需重启生效</div>
          </div>
          <input
            className="settings-input settings-input-port"
            type="text"
            inputMode="numeric"
            placeholder="5180"
            value={portDraft}
            onChange={e => setPortDraft(e.target.value)}
          />
        </div>
      </section>

      {/* ── 子应用自启 ────────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-title">子应用自启</div>
        <div className="settings-hint settings-section-hint">
          控制台启动后自动拉起选中的子应用。此设置独立于应用本身，商店更新不会丢失。
        </div>
        {apps.map(app => (
          <div className="settings-row" key={app.name}>
            <div className="settings-row-main">
              <div className="settings-label">
                {app.displayName || app.name}
                {app.ui?.port && <span className="mono settings-label-port">:{app.ui.port}</span>}
              </div>
              <div className="settings-hint">
                {app.autoStartOverridden
                  ? `已覆盖默认（应用声明：${app.manifestAutoStart ? '自启' : '不自启'}）`
                  : `应用声明默认：${app.manifestAutoStart ? '自启' : '不自启'}`}
              </div>
            </div>
            <div className="settings-row-actions">
              {app.autoStartOverridden && (
                <button
                  className="btn btn-secondary btn-xs"
                  disabled={busy}
                  title="清除覆盖，改回应用声明的默认值"
                  onClick={() => resetAutoStart(app)}
                >
                  恢复默认
                </button>
              )}
              <Toggle
                checked={!!app.autoStart}
                disabled={busy}
                onChange={next => toggleAutoStart(app, next)}
              />
            </div>
          </div>
        ))}
        {apps.length === 0 && <div className="empty-note">未发现子应用</div>}
      </section>

      {/* ── 环境变量 ──────────────────────────────── */}
      {ENV_GROUPS.map(group => (
        <section className="settings-section" key={group.title}>
          <div className="settings-section-title">{group.title}</div>
          <div className="settings-hint settings-section-hint">{group.hint}</div>
          {group.keys.map(key => {
            const info = envKeyMap[key] || {}
            return (
              <div className="settings-row settings-row-env" key={key}>
                <div className="settings-row-main">
                  <div className="settings-label">{ENV_LABELS[key] || key}</div>
                  <div className="settings-hint">
                    <span className="mono">{key}</span>
                    {info.source === 'shell'
                      ? ' · 当前生效：shell 环境变量（优先于此处配置）'
                      : info.source === 'file'
                        ? ' · 当前生效：此处配置'
                        : ' · 未设置'}
                  </div>
                </div>
                <input
                  className="settings-input"
                  type="text"
                  spellCheck={false}
                  placeholder={ENV_PLACEHOLDERS[key] || ''}
                  value={envDraft[key] || ''}
                  onChange={e => setEnvDraft(d => ({ ...d, [key]: e.target.value }))}
                />
              </div>
            )
          })}
        </section>
      ))}

      <div className="settings-env-note">
        环境变量在控制台启动时注入并传递给子应用；已由 shell 环境变量提供的值优先于此处配置
        （与 .env.example 声明的优先级一致）。改动需重启控制台后生效。
      </div>

      {/* ── 关于 / 诊断 ───────────────────────────── */}
      <section className="settings-section">
        <div className="settings-section-title">关于与诊断</div>

        <div className="settings-kv-row">
          <span className="settings-kv-k">控制台</span>
          <span className="mono settings-kv-v">v{meta.versions.shell} · Electron {meta.versions.electron} · Node {meta.versions.node} · Chromium {meta.versions.chrome}</span>
        </div>

        <div className="settings-kv-row">
          <span className="settings-kv-k">配置文件</span>
          <span className="mono settings-kv-v">{meta.configPath}</span>
          <button className="btn btn-secondary btn-xs" onClick={() => openPath('config')}>打开目录</button>
        </div>

        <div className="settings-kv-row">
          <span className="settings-kv-k">安装目录</span>
          <span className="mono settings-kv-v">
            {meta.projectsDir}
            {!meta.projectsDirAccessible && <span className="meta-warn">（不可访问）</span>}
          </span>
          <button className="btn btn-secondary btn-xs" onClick={() => openPath('projects')}>打开目录</button>
        </div>

        <div className="settings-row settings-row-last">
          <div className="settings-row-main">
            <div className="settings-label">重启控制台</div>
            <div className="settings-hint">让环境变量与端口改动生效；运行中的子应用会停止后随控制台重新拉起</div>
          </div>
          <button className="btn btn-secondary" disabled={busy} onClick={restartConsole}>
            重启
          </button>
        </div>
      </section>

      {/* ── 底部保存条 ────────────────────────────── */}
      {(dirty || busy) && (
        <div className="settings-savebar">
          <span className="settings-savebar-hint">
            {dirty ? '有未保存的改动' : '处理中…'}
          </span>
          <div className="settings-savebar-actions">
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => { setEnvDraft(Object.fromEntries((meta.envKeys || []).map(k => [k.key, k.value || '']))); setPortDraft(settings.general.consolePort ?? '') }}
            >
              放弃
            </button>
            <button className="btn btn-primary" disabled={busy || !dirty} onClick={saveEdits}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
