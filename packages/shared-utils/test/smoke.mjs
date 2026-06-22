/**
 * shared-utils smoke 测试
 *
 * 目的：在不依赖 electron 运行环境的情况下，验证：
 * 1. barrel 与各子路径 export 都可以正常 import
 * 2. 纯函数模块的基础行为
 * 3. env.js 注入点工作正常
 * 4. logger 在未 initLogger 时落到 fallback、不抛错
 * 5. proxyManager 在未注入 proxyEnabledReader 时默认 false
 *
 * 注：不主动调用 initLogger()，因为那会拉起 electron-log，需要在
 *     真实 electron 进程或注入 importers.electronLog 时才有意义。
 */

import assert from 'node:assert/strict'

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

console.log('shared-utils smoke')

// ---------- 1. barrel 入口 ----------
const barrel = await import('../src/index.js')
await test('barrel 导出 setSharedEnv/getSharedEnv', () => {
  assert.equal(typeof barrel.setSharedEnv, 'function')
  assert.equal(typeof barrel.getSharedEnv, 'function')
})
await test('barrel 导出 logger 相关', () => {
  assert.equal(typeof barrel.initLogger, 'function')
  assert.equal(typeof barrel.getLogger, 'function')
  assert.equal(typeof barrel.log, 'object')
  assert.equal(typeof barrel.createLazyLogger, 'function')
  assert.equal(typeof barrel.formatForLog, 'function')
})
await test('barrel 导出 proxyManager 相关', () => {
  assert.equal(typeof barrel.isProxyEnabled, 'function')
  assert.equal(typeof barrel.getSystemProxyUrl, 'function')
  assert.equal(typeof barrel.buildSubAppEnvironment, 'function')
})
await test('barrel 导出 timestamp/jsonUtils/常量', () => {
  assert.equal(typeof barrel.formatLocalTimestamp, 'function')
  assert.equal(typeof barrel.safeJsonParse, 'function')
  assert.equal(typeof barrel.PROVIDER_DISPLAY_NAMES, 'object')
  assert.equal(typeof barrel.getProviderDisplayName, 'function')
})

// ---------- 2. 子路径 exports ----------
await test('子路径 ./env 可 import', async () => {
  const m = await import('@xingseq/shared-utils/env')
  assert.equal(typeof m.setSharedEnv, 'function')
})
await test('子路径 ./logger 可 import', async () => {
  const m = await import('@xingseq/shared-utils/logger')
  assert.equal(typeof m.getLogger, 'function')
})
await test('子路径 ./proxyManager 可 import', async () => {
  const m = await import('@xingseq/shared-utils/proxyManager')
  assert.equal(typeof m.isProxyEnabled, 'function')
})
await test('子路径 ./timestamp 可 import', async () => {
  const m = await import('@xingseq/shared-utils/timestamp')
  assert.equal(typeof m.formatLocalTimestamp, 'function')
})
await test('子路径 ./jsonUtils 可 import', async () => {
  const m = await import('@xingseq/shared-utils/jsonUtils')
  assert.equal(typeof m.safeJsonParse, 'function')
})
await test('子路径 ./constants/provider 可 import', async () => {
  const m = await import('@xingseq/shared-utils/constants/provider')
  assert.equal(typeof m.PROVIDER_DISPLAY_NAMES, 'object')
})

// ---------- 3. 纯函数行为 ----------
await test('timestamp.formatLocalTimestamp 返回字符串', () => {
  const s = barrel.formatLocalTimestamp(new Date('2026-01-02T03:04:05Z'))
  assert.equal(typeof s, 'string')
  assert.ok(s.length > 0)
})
await test('jsonUtils.safeJsonParse 正常解析/非法抛错', () => {
  assert.deepEqual(barrel.safeJsonParse('{"a":1}'), { a: 1 })
  assert.throws(() => barrel.safeJsonParse('not json', 'smoke-ctx'), /JSON 解析失败/)
})
await test('jsonUtils.stripBOM 去除 BOM', () => {
  assert.equal(barrel.stripBOM('\uFEFFhello'), 'hello')
  assert.equal(barrel.stripBOM('hello'), 'hello')
})
await test('providerConstants.getProviderDisplayName', () => {
  const name = barrel.getProviderDisplayName('deepseek')
  assert.equal(typeof name, 'string')
  assert.ok(name.length > 0)
})

// ---------- 4. env 注入点 ----------
await test('setSharedEnv 合并 patch', () => {
  barrel.setSharedEnv({ isCLI: true })
  assert.equal(barrel.getSharedEnv().isCLI, true)
  // importers 应保留默认 electronLog
  assert.equal(typeof barrel.getSharedEnv().importers.electronLog, 'function')
  // 还原
  barrel.setSharedEnv({ isCLI: false })
})
await test('setSharedEnv 深合并 importers', () => {
  const fake = () => ({})
  barrel.setSharedEnv({ importers: { cliLogger: fake } })
  const env = barrel.getSharedEnv()
  assert.equal(env.importers.cliLogger, fake)
  assert.equal(typeof env.importers.electronLog, 'function') // 未被覆盖
  // 还原
  barrel.setSharedEnv({ importers: { cliLogger: null } })
})

// ---------- 5. logger fallback ----------
await test('getLogger 未 init 时返回 fallback', () => {
  const logger = barrel.getLogger('smoke')
  assert.equal(typeof logger.info, 'function')
  assert.equal(typeof logger.error, 'function')
  // 不应抛错
  logger.info('hello from fallback')
})
await test('default log 代理在未 init 时可调用', () => {
  // 通过 Proxy 落到 fallback，不应抛错
  barrel.log.info('hello via default proxy')
})

// ---------- 6. proxyManager 默认行为 ----------
await test('isProxyEnabled 默认 false（无注入）', async () => {
  // 清缓存以保证读到新值
  barrel.clearProxyCache()
  const enabled = await barrel.isProxyEnabled()
  assert.equal(enabled, false)
})
await test('proxyEnabledReader 注入后生效', async () => {
  barrel.setSharedEnv({ proxyEnabledReader: async () => true })
  barrel.clearProxyCache()
  const enabled = await barrel.isProxyEnabled()
  assert.equal(enabled, true)
  // 还原
  barrel.setSharedEnv({ proxyEnabledReader: async () => false })
  barrel.clearProxyCache()
})
await test('buildSubAppEnvironment 关代理时移除 *_PROXY', async () => {
  const before = process.env.HTTPS_PROXY
  process.env.HTTPS_PROXY = 'http://example.invalid:1'
  const env = await barrel.buildSubAppEnvironment()
  assert.equal(env.HTTPS_PROXY, undefined)
  assert.equal(env._useProxy, 'false')
  if (before === undefined) delete process.env.HTTPS_PROXY
  else process.env.HTTPS_PROXY = before
})

// ---------- 汇总 ----------
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
