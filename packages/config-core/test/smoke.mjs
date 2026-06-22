/**
 * config-core smoke 测试
 *
 * 用临时目录作为 userData，验证：
 * 1. helpers.getUserDataPath() 在未注入 getApp 时抛错
 * 2. saveGeneralConfig / loadGeneralConfig 往返 + 3s 缓存
 * 3. clearGeneralConfigCache 后强制读盘
 * 4. loadModelConfig 文件不存在时返回 deepseek 默认
 * 5. getApiKeyByProvider 环境变量优先
 * 6. readProxyEnabled 从 general.json 读 useProxy
 * 7. loadSystemModelConfig 未注入 path 时空数组；注入后能读
 * 8. saveProviderSubModels / loadProviderSubModels 往返 + isReasoner 补全
 */

import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

import { setSharedEnv, getSharedEnv } from '@xingseq/shared-utils/env'

let failed = 0
let passed = 0
async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.log(`  ✗ ${name}`)
    console.log(`    ${err.message}`)
    failed++
  }
}

console.log('config-core smoke')

// 准备临时 userData
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xingseq-config-core-'))
const fakeApp = {
  getPath: (name) => {
    if (name === 'userData') return tmpRoot
    if (name === 'logs') return path.join(tmpRoot, 'logs')
    throw new Error(`unknown path: ${name}`)
  }
}

// ---------- 1. 未注入 getApp 时 helpers 抛错 ----------
await test('helpers.getUserDataPath 未注入 getApp 抛错', async () => {
  const { getUserDataPath } = await import('@xingseq/config-core/helpers')
  // 先确保 env.getApp 为 null
  setSharedEnv({ getApp: null })
  await assert.rejects(getUserDataPath(), /未注入 getApp/)
})

// 注入 getApp
setSharedEnv({ getApp: async () => fakeApp })

// 动态 import 必须在注入后
const cfg = await import('@xingseq/config-core')

// ---------- 2. saveGeneralConfig / loadGeneralConfig 往返 ----------
await test('saveGeneralConfig 往返', async () => {
  cfg.clearGeneralConfigCache()
  const r = await cfg.saveGeneralConfig({ theme: 'dark', language: 'en-US', useProxy: true })
  assert.equal(r.success, true)
  cfg.clearGeneralConfigCache()
  const loaded = await cfg.loadGeneralConfig()
  assert.equal(loaded.success, true)
  assert.equal(loaded.data.theme, 'dark')
  assert.equal(loaded.data.useProxy, true)
})

// ---------- 3. 缓存命中 ----------
await test('loadGeneralConfig 3s 内命中缓存', async () => {
  cfg.clearGeneralConfigCache()
  await cfg.loadGeneralConfig() // 暖 cache
  // 直接删文件，缓存仍应可用
  await fs.rm(path.join(tmpRoot, 'config', 'general.json'))
  const r = await cfg.loadGeneralConfig()
  assert.equal(r.success, true)
  assert.equal(r.data.theme, 'dark') // 仍是缓存里的
})

// ---------- 4. clearGeneralConfigCache 强制刷新到默认 ----------
await test('clearGeneralConfigCache 后读到默认（文件已被删）', async () => {
  cfg.clearGeneralConfigCache()
  const r = await cfg.loadGeneralConfig()
  assert.equal(r.success, true)
  // 文件已删，回到 DEFAULT_GENERAL_CONFIG
  assert.equal(r.data.theme, 'system')
  assert.equal(r.data.useProxy, false)
})

// ---------- 5. loadModelConfig 默认值 ----------
await test('loadModelConfig 不存在时返回 deepseek 默认', async () => {
  const r = await cfg.loadModelConfig()
  assert.equal(r.success, true)
  assert.equal(Array.isArray(r.data.models), true)
  assert.equal(r.data.models[0].provider, 'deepseek')
  assert.equal(r.data.models[0].isDefault, true)
})

// ---------- 6. getApiKeyByProvider 环境变量优先 ----------
await test('getApiKeyByProvider 环境变量优先', async () => {
  const before = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'sk-env-test'
  const k = await cfg.getApiKeyByProvider('deepseek')
  assert.equal(k, 'sk-env-test')
  if (before === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = before
})
await test('getApiKeyByProvider 未知 provider 回退 deepseek', async () => {
  const before = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'sk-fallback'
  const k = await cfg.getApiKeyByProvider('not-exist-provider')
  assert.equal(k, 'sk-fallback')
  if (before === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = before
})

// ---------- 7. readProxyEnabled ----------
await test('readProxyEnabled 读 general.json 中的 useProxy', async () => {
  cfg.clearGeneralConfigCache()
  await cfg.saveGeneralConfig({ ...cfg.DEFAULT_GENERAL_CONFIG, useProxy: true })
  cfg.clearGeneralConfigCache()
  assert.equal(await cfg.readProxyEnabled(), true)
  cfg.clearGeneralConfigCache()
  await cfg.saveGeneralConfig({ ...cfg.DEFAULT_GENERAL_CONFIG, useProxy: false })
  cfg.clearGeneralConfigCache()
  assert.equal(await cfg.readProxyEnabled(), false)
})

// ---------- 8. loadSystemModelConfig ----------
await test('loadSystemModelConfig 未注入 path 返回空数组', async () => {
  setSharedEnv({ systemModelsPath: null })
  const r = await cfg.loadSystemModelConfig()
  assert.equal(r.success, true)
  assert.deepEqual(r.systemModels, [])
})
await test('loadSystemModelConfig 注入 path 后能读', async () => {
  const sysPath = path.join(tmpRoot, 'systemModels.json')
  await fs.writeFile(sysPath, JSON.stringify({
    systemModels: [{ id: 'fake-1', provider: 'deepseek' }]
  }), 'utf-8')
  setSharedEnv({ systemModelsPath: sysPath })
  const r = await cfg.loadSystemModelConfig()
  assert.equal(r.success, true)
  assert.equal(r.systemModels.length, 1)
  assert.equal(r.systemModels[0].id, 'fake-1')
})

// ---------- 9. Provider 子模型往返 ----------
await test('loadProviderSubModels 首次落盘默认表', async () => {
  const r = await cfg.loadProviderSubModels()
  assert.equal(r.success, true)
  assert.equal(typeof r.data.deepseek, 'object')
  // 文件应已被写
  const fp = path.join(tmpRoot, 'config', 'providerSubModels.json')
  await fs.access(fp)
})
await test('loadProviderSubModels 自动补全 isReasoner', async () => {
  const fp = path.join(tmpRoot, 'config', 'providerSubModels.json')
  // 写一个缺 isReasoner 的版本
  await fs.writeFile(fp, JSON.stringify({
    deepseek: {
      name: 'DeepSeek',
      subModels: [{ value: 'deepseek-v4-pro', label: 'pro' }] // 无 isReasoner
    }
  }), 'utf-8')
  const r = await cfg.loadProviderSubModels()
  assert.equal(r.success, true)
  const pro = r.data.deepseek.subModels.find(m => m.value === 'deepseek-v4-pro')
  assert.equal(pro.isReasoner, true) // 应被补全为 true（与默认表一致）
})

// ---------- 清理 ----------
await fs.rm(tmpRoot, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
