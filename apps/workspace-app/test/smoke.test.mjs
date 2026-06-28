#!/usr/bin/env node
/**
 * workspace-app 烟雾测试
 *
 * 验证：
 *   1. 工作区解析（名称式 + 绝对路径）
 *   2. provider 工厂装配
 *   3. server 可启动（不做真实 LLM 调用）
 */

import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { setSharedEnv } from '@xingseq/shared-utils/env'

// 注入 shared env
const tmpData = path.join(os.tmpdir(), 'xingseq-ws-app-test')
fs.mkdirSync(tmpData, { recursive: true })

setSharedEnv({
  isCLI: true,
  importers: {
    cliLogger: () => import('electron-log/node.js').catch(() => ({ default: console }))
  },
  getApp: () => ({
    getPath: () => tmpData,
    isReady: () => true,
    whenReady: async () => {}
  }),
  systemModelsPath: null
})

const { readProxyEnabled } = await import('@xingseq/config-core')
setSharedEnv({ proxyEnabledReader: readProxyEnabled })

let passed = 0
let failed = 0

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`)
    passed++
  } else {
    console.error(`  ✗ ${msg}`)
    failed++
  }
}

console.log('\n[workspace-app smoke test]\n')

// ===== 1. 工作区解析：名称式 =====
console.log('1. 工作区解析')
const { resolveWorkspace, ensureWorkspace } = await import('../src/workspace.mjs')

const ws1 = resolveWorkspace({ workspace: 'test-ws' })
assert(ws1.name === 'test-ws', '名称式 name')
assert(ws1.mounted === false, '名称式 mounted=false')
assert(ws1.filesDir.includes('workspaces/test-ws/files'), '名称式 filesDir')

// ===== 2. 工作区解析：绝对路径 =====
const testDir = path.join(os.tmpdir(), 'xingseq-ws-smoke-mount')
fs.mkdirSync(testDir, { recursive: true })

const ws2 = resolveWorkspace({ workspacePath: testDir })
assert(ws2.mounted === true, '路径式 mounted=true')
assert(ws2.filesDir === testDir, '路径式 filesDir = 挂载路径')
assert(ws2.memoryDir.includes('memory/'), '路径式 memoryDir 隔离')

// ===== 3. 非法路径拒绝 =====
let threw = false
try { resolveWorkspace({ workspacePath: 'relative/path' }) }
catch { threw = true }
assert(threw, '相对路径被拒绝')

// ===== 4. 非法 name 拒绝 =====
threw = false
try { resolveWorkspace({ workspace: '../hack' }) }
catch { threw = true }
assert(threw, '非法 workspace name 被拒绝')

// ===== 5. ensureWorkspace 首次创建 =====
const ws3 = resolveWorkspace({ workspace: `smoke-${Date.now()}` })
const result = await ensureWorkspace(ws3)
assert(result.created === true, 'ensureWorkspace 首次创建')
assert(fs.existsSync(ws3.filesDir), 'filesDir 已创建')
assert(fs.existsSync(path.join(ws3.filesDir, 'README.md')), '欢迎文件已写入')

// ===== 6. ensureWorkspace 路径挂载（不存在的路径报错） =====
const badWs = resolveWorkspace({ workspacePath: '/nonexistent/path/xyz' })
threw = false
try { await ensureWorkspace(badWs) }
catch { threw = true }
assert(threw, '挂载不存在目录时报错')

// ===== 7. provider 工厂 =====
console.log('\n2. Provider 工厂')
const { createProvider, resolveProviderType } = await import('../src/provider.mjs')
assert(resolveProviderType() === 'chat-core', '默认 provider type = chat-core')

threw = false
try { createProvider({ type: 'agent' }) }
catch { threw = true }
assert(threw, 'agent 未实现时抛错')

threw = false
try { createProvider({ type: 'unknown' }) }
catch { threw = true }
assert(threw, '未知 type 抛错')

// ===== 8. createProvider 正常 =====
const { createWorkspaceRegistry } = await import('@xingseq/chat-core')
const wsForSession = resolveWorkspace({ workspace: `smoke-sess-${Date.now()}` })
await ensureWorkspace(wsForSession)
const registry = await createWorkspaceRegistry({
  workspace: wsForSession,
  enableFs: true,
  enableShell: true,
  enableWeb: false,
  enableEmail: false
})
const session = createProvider({ id: 'test-1', workspace: wsForSession, registry })
assert(session.id === 'test-1', 'session.id 正确')
assert(typeof session.chat === 'function', 'session.chat 是函数')
assert(typeof session.save === 'function', 'session.save 是函数')
assert(typeof session.load === 'function', 'session.load 是函数')

// ===== 汇总 =====
console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`)

// 清理
fs.rmSync(tmpData, { recursive: true, force: true })
fs.rmSync(testDir, { recursive: true, force: true })
if (fs.existsSync(ws3.root)) fs.rmSync(ws3.root, { recursive: true, force: true })
if (fs.existsSync(wsForSession.root)) fs.rmSync(wsForSession.root, { recursive: true, force: true })

process.exit(failed > 0 ? 1 : 0)
