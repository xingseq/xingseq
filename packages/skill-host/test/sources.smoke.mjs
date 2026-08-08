#!/usr/bin/env node
/**
 * skill-host 商店源冒烟测试（无网络依赖，registry 由本地 HTTP 服务模拟）
 *
 * 覆盖：
 *   1. sources CRUD：添加/禁用/删除、official 保护、无效/重复/不可达 URL 拒绝
 *   2. fetchAllRegistries 合并去重（前序源优先）、单源失败隔离（sourceErrors）
 *   3. createSkillHost 注册表缓存及源变更后的缓存失效
 *
 * 用法：node packages/skill-host/test/sources.smoke.mjs
 */

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import {
  listSources, addSource, removeSource, setSourceEnabled,
  OFFICIAL_SOURCE_ID, sourcesFilePath
} from '../src/sources.js'
import { fetchAllRegistries, fetchRemoteManifest, resolveManifestRawUrl } from '../src/registry.js'
import { createSkillHost } from '../src/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 临时目录放在包内，避免写 ~/Library（沙箱/污染）
const tmpRoot = path.join(__dirname, '.tmp-sources-smoke')
const projectsDir = path.join(tmpRoot, 'projects')

// ── 本地 registry 服务 ────────────────────────────────────────────────────────
const registries = {
  '/a.json': {
    version: 1,
    subApps: [
      { name: 'folder-sync-alias', repo: 'https://github.com/xingseq/folder-sync', branch: 'main', manifestPath: 'sub-app-manifest.json', source: 'github' },
      { name: 'dup-app', repo: 'https://github.com/example/dup-a', branch: 'main', manifestPath: 'sub-app-manifest.json', source: 'github' }
    ]
  },
  '/b.json': {
    version: 1,
    subApps: [
      { name: 'dup-app', repo: 'https://github.com/example/dup-b', branch: 'main', manifestPath: 'sub-app-manifest.json', source: 'github' },
      { name: 'b-only', repo: 'https://github.com/example/b-only', branch: 'main', manifestPath: 'sub-app-manifest.json', source: 'github' }
    ]
  },
  '/bad-format.json': { hello: 'no subApps here' },
  // 非 GitHub 源的 raw manifest（gitea 约定路径 / rawUrlTemplate 自定义路径）
  '/ws/demo-app/raw/branch/main/sub-app-manifest.json': { name: 'gitea-app', version: '1.1.0' },
  '/whatever/custom/dev/sub-app-manifest.json': { name: 'tpl-app', version: '2.0.0' }
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const body = registries[req.url]
      if (!body) { res.writeHead(404); return res.end('not found') }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function rejects(fn, keyword, label) {
  try {
    await fn()
  } catch (err) {
    assert.ok(err.message.includes(keyword), `${label}: 期望错误包含「${keyword}」，实际「${err.message}」`)
    console.log(`  ✓ ${label}`)
    return
  }
  assert.fail(`${label}: 期望抛出错误但成功了`)
}

const server = await startServer()
const base = `http://127.0.0.1:${server.address().port}`
const urlA = `${base}/a.json`
const urlB = `${base}/b.json`

try {
  await fs.rm(tmpRoot, { recursive: true, force: true })
  await fs.mkdir(projectsDir, { recursive: true })

  // ── 1. sources CRUD ───────────────────────────────────────────────────────
  console.log('1. sources CRUD')

  let sources = await listSources(projectsDir)
  assert.equal(sources.length, 1)
  assert.equal(sources[0].id, OFFICIAL_SOURCE_ID)
  assert.equal(sources[0].official, true)
  console.log('  ✓ 初始仅官方源且恒在首位')

  await rejects(() => addSource(projectsDir, { name: 'x', url: 'not-a-url' }), '无效的 URL', '无效 URL 拒绝')
  await rejects(() => addSource(projectsDir, { name: 'x', url: 'ftp://example.com/r.json' }), 'http/https', '非 http/https 拒绝')
  await rejects(() => addSource(projectsDir, { name: '', url: urlA }), '名称不能为空', '空名称拒绝')
  await rejects(() => addSource(projectsDir, { name: 'x', url: 'http://127.0.0.1:1/r.json' }), '拉取注册中心失败', '不可达源拒绝')
  await rejects(() => addSource(projectsDir, { name: 'x', url: `${base}/bad-format.json` }), '缺少 subApps', '无效 registry 格式拒绝')

  const srcA = await addSource(projectsDir, { name: '测试源A', url: urlA })
  assert.ok(srcA.id && srcA.enabled && srcA.addedAt)
  console.log('  ✓ 添加合法源成功（试拉验证通过）')

  await rejects(() => addSource(projectsDir, { name: '重复', url: urlA }), '已存在', '重复 URL 拒绝')

  const fileRaw = JSON.parse(await fs.readFile(sourcesFilePath(projectsDir), 'utf-8'))
  assert.equal(fileRaw.sources.length, 1)
  console.log('  ✓ 落盘 store-sources.json（官方源不落盘）')

  await rejects(() => removeSource(projectsDir, OFFICIAL_SOURCE_ID), '不可删除', '官方源删除保护')
  await rejects(() => setSourceEnabled(projectsDir, OFFICIAL_SOURCE_ID, false), '不可禁用', '官方源禁用保护')

  const disabled = await setSourceEnabled(projectsDir, srcA.id, false)
  assert.equal(disabled.enabled, false)
  const enabled = await setSourceEnabled(projectsDir, srcA.id, true)
  assert.equal(enabled.enabled, true)
  console.log('  ✓ 第三方源启用/禁用')

  // ── 2. fetchAllRegistries 合并去重 ────────────────────────────────────────
  console.log('2. fetchAllRegistries 合并去重')

  const merged = await fetchAllRegistries([
    { id: 'a', name: '源A', url: urlA, enabled: true },
    { id: 'b', name: '源B', url: urlB, enabled: true },
    { id: 'bad', name: '坏源', url: 'http://127.0.0.1:1/r.json', enabled: true }
  ])
  const names = merged.subApps.map(e => e.name)
  assert.deepEqual(names, ['folder-sync-alias', 'dup-app', 'b-only'])
  const dup = merged.subApps.find(e => e.name === 'dup-app')
  assert.equal(dup.sourceId, 'a', '同名条目应保留前序源（先到先得）')
  assert.equal(dup.repo, 'https://github.com/example/dup-a')
  assert.equal(merged.subApps.find(e => e.name === 'b-only').sourceName, '源B')
  assert.equal(merged.sourceErrors.length, 1)
  assert.equal(merged.sourceErrors[0].sourceId, 'bad')
  console.log('  ✓ 同名去重（前序源优先）+ 来源标注 + 单源失败隔离')

  const skipDisabled = await fetchAllRegistries([
    { id: 'a', name: '源A', url: urlA, enabled: true },
    { id: 'b', name: '源B', url: urlB, enabled: false }
  ])
  assert.ok(!skipDisabled.subApps.some(e => e.sourceId === 'b'))
  assert.equal(skipDisabled.sourceErrors.length, 0)
  console.log('  ✓ 禁用源被跳过')

  // ── 3. createSkillHost 缓存与失效 ─────────────────────────────────────────
  console.log('3. createSkillHost 缓存与失效')

  // registryUrl 单源模式（向后兼容）：官方源 URL 被覆盖为本地 A
  const host = createSkillHost({ projectsDir, registryUrl: urlA })
  const reg1 = await host.fetchRegistry()
  assert.equal(reg1.subApps.length, 2)
  assert.equal(reg1.subApps[0].sourceId, OFFICIAL_SOURCE_ID)

  // 修改服务端数据 → 缓存期内不变
  registries['/a.json'].subApps.push({ name: 'late-app', repo: 'https://github.com/example/late', branch: 'main', manifestPath: 'sub-app-manifest.json', source: 'github' })
  const reg2 = await host.fetchRegistry()
  assert.equal(reg2.subApps.length, 2, '5 分钟 TTL 内应命中缓存')
  console.log('  ✓ 注册表缓存命中')

  // 源变更 → 缓存失效，重新拉取拿到新数据
  const srcB = await host.addSource({ name: '测试源B', url: urlB })
  const reg3 = await host.fetchRegistry()
  assert.equal(reg3.subApps.length, 3, '源变更后缓存应失效')
  console.log('  ✓ 源变更后缓存失效')

  // listAvailable 返回 { apps, sourceErrors } 且透传来源
  const avail = await host.listAvailable()
  assert.ok(Array.isArray(avail.apps) && Array.isArray(avail.sourceErrors))
  assert.ok(avail.apps.every(a => a.sourceId === OFFICIAL_SOURCE_ID && a.status === 'available'))
  console.log('  ✓ listAvailable 透传 sourceId/sourceErrors')

  // 实例级源管理：删除后列表还原
  await host.removeSource(srcB.id)
  await host.removeSource(srcA.id)
  sources = await listSources(projectsDir)
  assert.equal(sources.length, 1)
  console.log('  ✓ 实例级 removeSource')

  // ── 4. 非 GitHub 源 manifest 拉取（gitea / rawUrlTemplate）─────────────
  console.log('4. 非 GitHub 源 manifest 拉取')

  // 默认行为不变：GitHub 改写为 raw.githubusercontent.com
  assert.equal(
    resolveManifestRawUrl({ name: 'x', repo: 'https://github.com/a/b.git', branch: 'main', manifestPath: 'sub-app-manifest.json', source: 'github' }),
    'https://raw.githubusercontent.com/a/b/main/sub-app-manifest.json',
    'GitHub 默认改写保持兼容'
  )
  // gitea 约定：{repo}/raw/branch/{branch}/{manifestPath}
  assert.equal(
    resolveManifestRawUrl({ name: 'x', repo: `${base}/ws/demo-app`, branch: 'main', manifestPath: 'sub-app-manifest.json', source: 'gitea' }),
    `${base}/ws/demo-app/raw/branch/main/sub-app-manifest.json`
  )
  // rawUrlTemplate 优先于 source，占位符展开
  assert.equal(
    resolveManifestRawUrl({ name: 'x', repo: `${base}/whatever.git`, branch: 'dev', manifestPath: 'sub-app-manifest.json', source: 'gitea', rawUrlTemplate: '{repo}/custom/{branch}/{manifestPath}' }),
    `${base}/whatever/custom/dev/sub-app-manifest.json`
  )
  console.log('  ✓ raw URL 解析（github 兼容 / gitea 约定 / 自定义模板优先）')

  const giteaMf = await fetchRemoteManifest({
    name: 'gitea-app', repo: `${base}/ws/demo-app`, branch: 'main',
    manifestPath: 'sub-app-manifest.json', source: 'gitea'
  })
  assert.equal(giteaMf.version, '1.1.0')
  console.log('  ✓ gitea 源实际拉取 raw manifest 成功')

  const tplMf = await fetchRemoteManifest({
    name: 'tpl-app', repo: `${base}/whatever`, branch: 'dev',
    manifestPath: 'sub-app-manifest.json',
    rawUrlTemplate: '{repo}/custom/{branch}/{manifestPath}'
  })
  assert.equal(tplMf.version, '2.0.0')
  console.log('  ✓ rawUrlTemplate 实际拉取成功')

  console.log('\n全部冒烟用例通过 ✅')
} finally {
  server.close()
  await fs.rm(tmpRoot, { recursive: true, force: true })
}
