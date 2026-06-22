/**
 * @xingseq/tool-registry smoke tests
 */
import assert from 'node:assert/strict'

import {
  // 注册中心
  createToolRegistry,
  // 确认
  createConfirmationManager,
  DEFAULT_SENSITIVE_TOOLS,
  buildDefaultConfirmMessage,
  // 查询
  getToolGroupsOverview,
  getAllTools,
  getToolsByGroup,
  getToolByName,
  getToolGroups,
  // 各组
  fileTools,
  directoryTools,
  fileManagementTools,
  commandTools,
  databaseTools,
  aiChatTools,
  aiDrawTools,
  flowGraphTools,
  customModelTools,
  documentationTools,
  subAppTools,
  agentTools,
  searchTools,
  authorizationTools,
  timerTools,
  emailTools,
  mockEmailTools,
  zhmmTools
} from '../src/index.js'

// 同时验证子路径 exports 可用
import { createToolRegistry as createToolRegistry2 } from '../src/registry.js'
import { createConfirmationManager as createConfirmationManager2 } from '../src/confirmation.js'
import * as defs from '../src/definitions/index.js'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); console.log('  ✓', name); pass++ }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); fail++ }
}
const ta = async (name, fn) => {
  try { await fn(); console.log('  ✓', name); pass++ }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); fail++ }
}

const isToolDef = (x) =>
  x && x.type === 'function' && x.function && typeof x.function.name === 'string'

console.log('\n[1] definitions barrel 全部组导出')
for (const [name, arr] of Object.entries({
  fileTools, directoryTools, fileManagementTools, commandTools, databaseTools,
  aiChatTools, aiDrawTools, flowGraphTools, customModelTools, documentationTools,
  subAppTools, agentTools, searchTools, authorizationTools, timerTools,
  emailTools, mockEmailTools, zhmmTools
})) {
  t(`${name} 是非空数组且每项符合 OpenAI Function Calling 形态`, () => {
    assert.ok(Array.isArray(arr), `${name} 不是数组`)
    assert.ok(arr.length > 0, `${name} 为空`)
    for (const def of arr) assert.ok(isToolDef(def), `${name} 中存在非法定义`)
  })
}

console.log('\n[2] 查询函数')
t('getToolGroupsOverview() 返回 load_tool_group 单元', () => {
  const ov = getToolGroupsOverview()
  assert.equal(ov.length, 1)
  assert.equal(ov[0].function.name, 'load_tool_group')
  const enums = ov[0].function.parameters.properties.group.enum
  assert.ok(enums.includes('file') && enums.includes('zhmm'))
})

t('getAllTools() 数量等于各组之和', () => {
  const all = getAllTools()
  const sum = [
    fileTools, directoryTools, fileManagementTools, commandTools, databaseTools,
    aiChatTools, aiDrawTools, flowGraphTools, customModelTools, documentationTools,
    subAppTools, agentTools, searchTools, authorizationTools, timerTools,
    emailTools, mockEmailTools, zhmmTools
  ].reduce((s, a) => s + a.length, 0)
  assert.equal(all.length, sum)
})

t('getToolsByGroup("file") 等于 fileTools', () => {
  assert.equal(getToolsByGroup('file').length, fileTools.length)
})

t('getToolsByGroup("flowGraph") 包含部分 documentation 工具（与 develop 行为一致）', () => {
  const g = getToolsByGroup('flowGraph')
  const names = g.map(t => t.function.name)
  assert.ok(names.includes('explore_docs'))
  assert.ok(names.includes('read_node_config_schema'))
})

t('getToolsByGroup("aiChat") 合并 searchTools', () => {
  const g = getToolsByGroup('aiChat')
  assert.equal(g.length, aiChatTools.length + searchTools.length)
})

t('getToolsByGroup("unknown") 返回 []', () => {
  assert.deepEqual(getToolsByGroup('unknown'), [])
})

t('getToolByName 命中 file 组工具', () => {
  const target = fileTools[0].function.name
  const def = getToolByName(target)
  assert.ok(def && def.function.name === target)
})

t('getToolByName 未命中返回 undefined', () => {
  assert.equal(getToolByName('definitely_not_exist_tool'), undefined)
})

t('getToolGroups() 至少包含 17 个键', () => {
  const groups = getToolGroups()
  assert.ok(Object.keys(groups).length >= 17)
  assert.ok(groups.file && groups.file.tools === fileTools)
})

console.log('\n[3] 子路径 exports / 双导入一致性')
t('registry / confirmation 子路径与 barrel 一致', () => {
  assert.equal(typeof createToolRegistry2, 'function')
  assert.equal(typeof createConfirmationManager2, 'function')
  assert.equal(createToolRegistry2.name, createToolRegistry.name)
})
t('definitions 子路径暴露 fileTools', () => {
  assert.equal(defs.fileTools, fileTools)
})

console.log('\n[4] createToolRegistry 行为')

const fakeFileTools = [
  { type: 'function', function: { name: 'fake_read', description: 'r', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'fake_write', description: 'w', parameters: { type: 'object', properties: {} } } }
]
const fakeDbTools = [
  { type: 'function', function: { name: 'fake_query', description: 'q', parameters: { type: 'object', properties: {} } } }
]

t('register + getOverview / getTools / getAllTools / getToolByName', () => {
  const r = createToolRegistry()
  r.register('file', { tools: fakeFileTools, handlers: { fake_read: async () => 'R', fake_write: async () => 'W' } })
  r.register('db', { displayName: '数据库', tools: fakeDbTools, execute: async (n) => `db:${n}` })

  assert.deepEqual(r.listGroups().sort(), ['db', 'file'])
  const ov = r.getOverview()
  assert.equal(ov.length, 2)
  const fileOv = ov.find(o => o.name === 'file')
  assert.equal(fileOv.toolCount, 2)
  assert.equal(r.getTools('file').length, 2)
  assert.equal(r.getAllTools().length, 3)
  assert.equal(r.getToolByName('fake_read').function.name, 'fake_read')
  assert.equal(r.getGroupOfTool('fake_query'), 'db')
})

t('register 缺少 execute/handlers 时抛错', () => {
  const r = createToolRegistry()
  assert.throws(() => r.register('x', { tools: [] }), /execute|handlers/)
})

t('register 非法 groupName 抛错', () => {
  const r = createToolRegistry()
  assert.throws(() => r.register('', { tools: [], execute: () => {} }), /groupName/)
})

await ta('dispatch 命中 handlers', async () => {
  const r = createToolRegistry()
  r.register('file', { tools: fakeFileTools, handlers: { fake_read: async (args) => ({ ok: true, p: args.path }) } })
  const out = await r.dispatch({ name: 'fake_read', args: { path: '/x' } })
  assert.deepEqual(out, { ok: true, p: '/x' })
})

await ta('dispatch 命中 execute（fallback）', async () => {
  const r = createToolRegistry()
  r.register('db', { tools: fakeDbTools, execute: async (n, a) => ({ tool: n, a }) })
  const out = await r.dispatch({ name: 'fake_query', args: { sql: 'select 1' } })
  assert.deepEqual(out, { tool: 'fake_query', a: { sql: 'select 1' } })
})

await ta('dispatch 支持 OpenAI tool_call 形态（function.name + JSON arguments）', async () => {
  const r = createToolRegistry()
  r.register('file', { tools: fakeFileTools, handlers: { fake_write: async (a) => a } })
  const out = await r.dispatch({ function: { name: 'fake_write' }, arguments: '{"path":"/y","content":"hi"}' })
  assert.deepEqual(out, { path: '/y', content: 'hi' })
})

await ta('dispatch 未注册工具抛错', async () => {
  const r = createToolRegistry()
  r.register('file', { tools: fakeFileTools, execute: async () => null })
  await assert.rejects(() => r.dispatch({ name: 'no_such_tool' }), /未注册/)
})

await ta('dispatch JSON.parse 失败时抛错', async () => {
  const r = createToolRegistry()
  r.register('file', { tools: fakeFileTools, handlers: { fake_read: async () => 1 } })
  await assert.rejects(() => r.dispatch({ name: 'fake_read', arguments: '{not-json' }), /JSON.parse/)
})

t('unregister 清理索引', () => {
  const r = createToolRegistry()
  r.register('file', { tools: fakeFileTools, execute: async () => null })
  assert.equal(r.unregister('file'), true)
  assert.equal(r.listGroups().length, 0)
  assert.equal(r.getToolByName('fake_read'), null)
  assert.equal(r.unregister('file'), false)
})

console.log('\n[5] createConfirmationManager 行为')

t('DEFAULT_SENSITIVE_TOOLS 含 11 项关键工具', () => {
  assert.equal(DEFAULT_SENSITIVE_TOOLS.length, 11)
  for (const n of ['set_file_content', 'execute_command', 'delete_record']) {
    assert.ok(DEFAULT_SENSITIVE_TOOLS.includes(n))
  }
})

t('buildDefaultConfirmMessage 各分支文案非空', () => {
  for (const tn of DEFAULT_SENSITIVE_TOOLS) {
    const { message, detail } = buildDefaultConfirmMessage(tn, { path: '/p', source_path: '/s', destination_path: '/d', command: 'ls', args: [], executable: '/bin/ls', table_name: 't', columns: [], url: 'http://x', save_path: '/o', old_string: 'a', new_string: 'b', content: 'x' })
    assert.ok(message.length > 0, `${tn} message 空`)
    assert.ok(detail.length > 0, `${tn} detail 空`)
  }
  // default 分支
  const { message } = buildDefaultConfirmMessage('unknown_tool', { foo: 1 })
  assert.match(message, /unknown_tool/)
})

t('requiresConfirmation 命中敏感工具', () => {
  const m = createConfirmationManager()
  assert.equal(m.requiresConfirmation('set_file_content'), true)
  assert.equal(m.requiresConfirmation('read_file'), false)
})

await ta('autoConfirm=true 直接通过', async () => {
  const m = createConfirmationManager({ autoConfirm: true })
  assert.equal(await m.confirmToolExecution('set_file_content', { path: '/x' }), true)
})

await ta('isCLI=true 直接通过', async () => {
  const m = createConfirmationManager({ isCLI: true })
  assert.equal(await m.confirmToolExecution('execute_command', { command: 'ls' }), true)
})

await ta('非敏感工具直接通过', async () => {
  const m = createConfirmationManager({})
  assert.equal(await m.confirmToolExecution('read_file', {}), true)
})

await ta('未注入 showConfirmDialog 时敏感工具默认拒绝', async () => {
  const m = createConfirmationManager({})
  assert.equal(await m.confirmToolExecution('set_file_content', { path: '/x' }), false)
})

await ta('showConfirmDialog 注入：用户确认 / 拒绝', async () => {
  let received = null
  const accept = createConfirmationManager({
    showConfirmDialog: async (p) => { received = p; return true }
  })
  assert.equal(await accept.confirmToolExecution('execute_command', { command: 'ls' }), true)
  assert.ok(received && received.toolName === 'execute_command' && received.message.length > 0)

  const reject = createConfirmationManager({
    showConfirmDialog: async () => false
  })
  assert.equal(await reject.confirmToolExecution('execute_command', { command: 'ls' }), false)
})

await ta('showConfirmDialog 抛错时返回 false', async () => {
  const m = createConfirmationManager({
    showConfirmDialog: async () => { throw new Error('boom') }
  })
  assert.equal(await m.confirmToolExecution('set_file_content', { path: '/x' }), false)
})

await ta('countdown：sendFrontendConfirm + resolvePendingConfirm 路径', async () => {
  let captured = null
  const m = createConfirmationManager({
    countdownConfigReader: async () => ({ enabled: true, seconds: 30, applyToTools: ['execute_command'] }),
    sendFrontendConfirm: async (payload) => { captured = payload }
  })
  const p = m.confirmToolExecution('execute_command', { command: 'ls' })
  // 等待事件循环让 sendFrontendConfirm 完成派发
  await new Promise(r => setImmediate(r))
  assert.ok(captured && captured.confirmId && captured.countdown === 30, 'sendFrontendConfirm 未收到')
  assert.equal(m.resolvePendingConfirm(captured.confirmId, true), true)
  assert.equal(await p, true)
})

await ta('countdown：到期自动 resolve(true)', async () => {
  const m = createConfirmationManager({
    countdownConfigReader: async () => ({ enabled: true, seconds: 0.05, applyToTools: ['execute_command'] }),
    sendFrontendConfirm: async () => {}
  })
  const ok = await m.confirmToolExecution('execute_command', { command: 'ls' })
  assert.equal(ok, true)
})

await ta('countdown 命中但未注入 sendFrontendConfirm 时回退为通过', async () => {
  const m = createConfirmationManager({
    countdownConfigReader: async () => ({ enabled: true, seconds: 1, applyToTools: ['execute_command'] })
  })
  assert.equal(await m.confirmToolExecution('execute_command', { command: 'ls' }), true)
})

await ta('countdown 配置 applyToTools 不含目标 → 走原生弹窗路径', async () => {
  let dialogCalled = false
  const m = createConfirmationManager({
    countdownConfigReader: async () => ({ enabled: true, seconds: 5, applyToTools: ['delete_record'] }),
    showConfirmDialog: async () => { dialogCalled = true; return true }
  })
  const ok = await m.confirmToolExecution('execute_command', { command: 'ls' })
  assert.equal(ok, true)
  assert.equal(dialogCalled, true)
})

t('clearCountdownConfigCache 不抛异常', () => {
  const m = createConfirmationManager({})
  m.clearCountdownConfigCache()
})

t('resolvePendingConfirm 未知 id 返回 false', () => {
  const m = createConfirmationManager({})
  assert.equal(m.resolvePendingConfirm('nope', true), false)
})

console.log(`\n[Summary] PASS: ${pass}, FAIL: ${fail}`)
if (fail > 0) process.exit(1)
