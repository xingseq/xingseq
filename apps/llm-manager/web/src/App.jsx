import React, { useState, useEffect, useCallback } from 'react'

// ==================== API 调用 ====================

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  return res.json()
}

// ==================== 主应用 ====================

export default function App() {
  const [models, setModels] = useState(null)
  const [providers, setProviders] = useState(null)
  const [defaultModel, setDefaultModel] = useState(null)
  const [editing, setEditing] = useState(null) // 正在编辑的模型
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [m, p, d] = await Promise.all([
      api('/models'),
      api('/providers'),
      api('/default-model')
    ])
    setModels(m)
    setProviders(p)
    setDefaultModel(d)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (loading) return <div className="loading">加载中...</div>

  const modelList = models?.models || []

  return (
    <div className="app">
      <header className="header">
        <h1>LLM 管理器</h1>
        <span className="config-path">~/.xingseq/config/</span>
      </header>

      {/* 模型卡片 */}
      <div className="model-grid">
        {modelList.map(model => (
          <ModelCard
            key={model.id}
            model={model}
            providers={providers}
            isDefault={defaultModel?.provider === model.provider}
            onEdit={() => setEditing(model)}
            onSetDefault={async () => {
              await api('/default-model', { method: 'PUT', body: JSON.stringify({ provider: model.provider }) })
              refresh()
            }}
            onDelete={async () => {
              const updated = { models: modelList.filter(m => m.id !== model.id) }
              await api('/models', { method: 'PUT', body: JSON.stringify(updated) })
              refresh()
            }}
          />
        ))}
        <AddModelCard onClick={() => setEditing({ id: '', name: '', provider: 'deepseek', apiKey: '', isDefault: false, _isNew: true })} />
      </div>

      {/* 全局设置 */}
      <GlobalSettings defaultModel={defaultModel} modelList={modelList} onSave={refresh} />

      {/* 编辑弹窗 */}
      {editing && (
        <EditModal
          model={editing}
          providers={providers}
          onClose={() => setEditing(null)}
          onSave={async (updated) => {
            let newList
            if (updated._isNew) {
              delete updated._isNew
              updated.id = updated.provider + '-' + Date.now()
              newList = [...modelList, updated]
            } else {
              newList = modelList.map(m => m.id === updated.id ? updated : m)
            }
            await api('/models', { method: 'PUT', body: JSON.stringify({ models: newList }) })
            setEditing(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

// ==================== 模型卡片 ====================

function ModelCard({ model, providers, isDefault, onEdit, onSetDefault, onDelete }) {
  const providerInfo = providers?.[model.provider]
  const subModelCount = providerInfo?.subModels?.length || 0

  return (
    <div className={`model-card ${isDefault ? 'is-default' : ''}`}>
      {isDefault && <span className="default-badge">默认</span>}
      <div className="provider-name">{model.name || providerInfo?.name || model.provider}</div>
      <div className="model-id">{model.provider}</div>
      <div className="sub-models-count">
        <StatusDot status={model.apiKey ? 'connected' : 'unknown'} />
        {subModelCount} 个子模型 · API Key {model.apiKey ? '已配置' : '未配置'}
      </div>
      <div className="card-actions">
        <button className="btn btn-outline" onClick={onEdit}>编辑</button>
        {!isDefault && <button className="btn btn-outline" onClick={onSetDefault}>设为默认</button>}
        <button className="btn btn-danger" onClick={onDelete}>删除</button>
      </div>
    </div>
  )
}

function AddModelCard({ onClick }) {
  return (
    <div className="model-card" onClick={onClick} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 140 }}>
      <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 28, marginBottom: 4 }}>+</div>
        <div style={{ fontSize: 13 }}>添加模型</div>
      </div>
    </div>
  )
}

function StatusDot({ status }) {
  return <span className={`status-dot ${status}`} />
}

// ==================== 编辑弹窗 ====================

function EditModal({ model, providers, onClose, onSave }) {
  const [form, setForm] = useState({ ...model })
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)

  const providerOptions = Object.entries(providers || {}).map(([key, val]) => ({
    value: key, label: val.name
  }))

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const result = await api('/test-connection', {
      method: 'POST',
      body: JSON.stringify({ provider: form.provider, apiKey: form.apiKey })
    })
    setTestResult(result)
    setTesting(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{form._isNew ? '添加模型' : '编辑模型'}</h2>

        <div className="form-group">
          <label>提供商</label>
          <select value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value, name: providers[e.target.value]?.name || '' })}>
            {providerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>名称</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="显示名称" />
        </div>

        <div className="form-group">
          <label>API Key</label>
          <input type="password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-outline" onClick={handleTest} disabled={testing || !form.apiKey}>
            {testing ? '测试中...' : '测试连接'}
          </button>
          {testResult && (
            <span className={`test-result ${testResult.ok ? 'ok' : 'fail'}`}>
              {testResult.ok ? `连接成功 (${testResult.latency_ms}ms)` : `失败: ${testResult.error}`}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={() => onSave(form)}>保存</button>
        </div>
      </div>
    </div>
  )
}

// ==================== 全局设置 ====================

function GlobalSettings({ defaultModel, modelList, onSave }) {
  const [provider, setProvider] = useState(defaultModel?.provider || 'deepseek')

  const handleChangeDefault = async (e) => {
    const newProvider = e.target.value
    setProvider(newProvider)
    await api('/default-model', { method: 'PUT', body: JSON.stringify({ provider: newProvider }) })
    onSave()
  }

  return (
    <div>
      <div className="section-title">全局设置</div>
      <div className="settings-row">
        <label>默认模型</label>
        <select value={provider} onChange={handleChangeDefault}>
          {modelList.map(m => <option key={m.id} value={m.provider}>{m.name || m.provider}</option>)}
        </select>
      </div>
    </div>
  )
}
