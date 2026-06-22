/**
 * @xingseq/memory-store smoke tests
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

// 在 import 业务模块前先注入 getApp，模拟 Electron 环境
import { setSharedEnv } from '@xingseq/shared-utils/env'
import { __resetForTest as resetDb } from '@xingseq/storage-core/database'

// 为 messageStorage 提供临时目录
const tmpDir = path.join(os.tmpdir(), `memory-store-smoke-${Date.now()}`)
const mockApp = {
  getPath: (key) => {
    if (key === 'userData') return tmpDir
    return tmpDir
  }
}

setSharedEnv({ getApp: () => mockApp })
process.env.NAJIE_USER_DATA_PATH = path.join(tmpDir, 'agent')

// 注入后再 import 业务模块（保证 getSharedEnv 有值）
const {
  getConversationFactory,
  getForkPathFactory,
  addMessage, getMessages, getUnreadCount,
  markAsRead, markAllAsRead, deleteMessage, clearAllMessages, getRechargeUrl,
  MEMORY_TYPES, PRIORITY,
  getAllMemories, addMemory, addMemories, updateMemory, deleteMemory,
  retrieveMemories, buildMemoryExtractionPrompt, parseAndSaveMemories,
  __resetMemoriesPath
} = await import('../src/index.js')

// 子路径 import 验证
const { getConversationFactory: cmFromPath } = await import('../src/conversationManager.js')
const { getForkPathFactory: fmFromPath } = await import('../src/forkPathManager.js')
const { getRechargeUrl: ruFromPath } = await import('../src/messageStorage.js')
const { MEMORY_TYPES: mtFromPath } = await import('../src/mainMemoryService.js')

// ── 测试工具 ──────────────────────────────────────────────────────────────────
let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try {
    const r = fn()
    if (r && typeof r.then === 'function') {
      return r.then(() => {
        console.log(`  ✓ ${name}`)
        passed++
      }).catch(err => {
        console.error(`  ✗ ${name}: ${err.message}`)
        errors.push({ name, err })
        failed++
      })
    }
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`)
    errors.push({ name, err })
    failed++
  }
}

// 初始化临时目录
await fs.mkdir(tmpDir, { recursive: true })

// ── 子路径 export 一致性 ──────────────────────────────────────────────────────
console.log('\n[子路径 exports 一致性]')
await test('conversationManager: 子路径与 barrel 导出同一工厂', () => {
  assert.strictEqual(cmFromPath, getConversationFactory)
})
await test('forkPathManager: 子路径与 barrel 导出同一工厂', () => {
  assert.strictEqual(fmFromPath, getForkPathFactory)
})
await test('messageStorage: getRechargeUrl 一致', () => {
  assert.strictEqual(ruFromPath, getRechargeUrl)
})
await test('mainMemoryService: MEMORY_TYPES 一致', () => {
  assert.strictEqual(mtFromPath, MEMORY_TYPES)
})

// ── ConversationManager ────────────────────────────────────────────────────────
console.log('\n[ConversationManager]')

// 重置 DB 到内存
await test('重置数据库到内存模式', async () => {
  resetDb()
  // initDatabase 会在第一次操作时懒调用
})

await test('getConversationFactory 返回工厂', () => {
  const f = getConversationFactory()
  assert.ok(f)
  assert.ok(typeof f.getManager === 'function')
})

await test('getManager(null) 返回全局管理器', () => {
  const f = getConversationFactory()
  const m = f.getManager(null)
  assert.ok(m)
  assert.strictEqual(m.tableName, 'conversations_global')
})

await test('getManager(projectId) 返回项目管理器', () => {
  const f = getConversationFactory()
  const m = f.getManager('proj-abc')
  assert.strictEqual(m.tableName, 'conversations_proj_abc')
})

await test('save + getAll: 保存并读取对话索引', async () => {
  resetDb()
  const f = getConversationFactory()
  const m = f.getManager(null)
  await m.createTable()
  const r = await m.save({ id: 'conv-1', title: '测试对话', date: new Date().toISOString() })
  assert.ok(r.success, r.error)
  const all = await m.getAll()
  assert.ok(all.success)
  assert.strictEqual(all.data.length, 1)
  assert.strictEqual(all.data[0].id, 'conv-1')
})

await test('delete: 软删除后 getAll 不包含', async () => {
  const f = getConversationFactory()
  const m = f.getManager(null)
  await m.delete('conv-1')
  const all = await m.getAll()
  assert.strictEqual(all.data.length, 0)
})

await test('getDeleted: 回收站能查到被删对话', async () => {
  const f = getConversationFactory()
  const m = f.getManager(null)
  const d = await m.getDeleted()
  assert.ok(d.success)
  assert.strictEqual(d.data.length, 1)
  assert.strictEqual(d.data[0].id, 'conv-1')
})

await test('restore: 恢复后 getAll 重新包含', async () => {
  const f = getConversationFactory()
  const m = f.getManager(null)
  await m.restore('conv-1')
  const all = await m.getAll()
  assert.strictEqual(all.data.length, 1)
})

await test('permanentDelete: 永久删除后回收站也清空', async () => {
  const f = getConversationFactory()
  const m = f.getManager(null)
  await m.delete('conv-1')
  await m.permanentDelete('conv-1')
  const d = await m.getDeleted()
  assert.strictEqual(d.data.length, 0)
})

await test('project 表隔离：项目对话不污染全局', async () => {
  const f = getConversationFactory()
  const pm = f.getManager('test-project')
  await pm.save({ id: 'proj-conv-1', title: '项目对话', date: new Date().toISOString() })
  const globalAll = await f.getManager(null).getAll()
  assert.strictEqual(globalAll.data.length, 0)
  const projAll = await pm.getAll()
  assert.strictEqual(projAll.data.length, 1)
})

// ── ForkPathManager ────────────────────────────────────────────────────────────
console.log('\n[ForkPathManager]')

await test('getForkPathFactory 返回工厂', () => {
  const f = getForkPathFactory()
  assert.ok(f)
  assert.ok(typeof f.getManager === 'function')
})

await test('saveForkPath + getForksBySource', async () => {
  const f = getForkPathFactory()
  const m = f.getManager(null)
  const r = await m.saveForkPath({
    sourceConversationId: 'src-conv',
    forkedConversationId: 'fork-conv',
    forkType: 'full'
  })
  assert.ok(r.success, r.error)
  assert.ok(r.id.startsWith('fork-'))

  const forks = await m.getForksBySource('src-conv')
  assert.ok(forks.success)
  assert.strictEqual(forks.data.length, 1)
  assert.strictEqual(forks.data[0].forked_conversation_id, 'fork-conv')
})

await test('getForkSource: 从分岔话题查源', async () => {
  const f = getForkPathFactory()
  const m = f.getManager(null)
  const result = await m.getForkSource('fork-conv')
  assert.ok(result.success)
  assert.strictEqual(result.data.source_conversation_id, 'src-conv')
})

await test('getForkTree: 获取分岔路径树', async () => {
  const f = getForkPathFactory()
  const m = f.getManager(null)
  const result = await m.getForkTree('src-conv')
  assert.ok(result.success)
  assert.strictEqual(result.data.length, 1)
  assert.ok(Array.isArray(result.data[0].children))
})

// ── MessageStorage ─────────────────────────────────────────────────────────────
console.log('\n[MessageStorage]')

await test('clearAllMessages: 清空成功', async () => {
  await clearAllMessages()
  const msgs = await getMessages()
  assert.strictEqual(msgs.length, 0)
})

await test('addMessage: 添加消息', async () => {
  const msg = await addMessage({ type: 'balance_alert', title: '余额不足', content: '请充值', provider: 'deepseek' })
  assert.ok(msg.id.startsWith('msg_'))
  assert.strictEqual(msg.read, false)
})

await test('getMessages: 能读到刚添加的消息', async () => {
  const msgs = await getMessages()
  assert.strictEqual(msgs.length, 1)
  assert.strictEqual(msgs[0].type, 'balance_alert')
})

await test('getUnreadCount: 未读数正确', async () => {
  const count = await getUnreadCount()
  assert.strictEqual(count, 1)
})

await test('markAsRead: 标记已读', async () => {
  const msgs = await getMessages()
  await markAsRead(msgs[0].id)
  const count = await getUnreadCount()
  assert.strictEqual(count, 0)
})

await test('markAllAsRead: 全部已读（先添加一条）', async () => {
  await addMessage({ type: 'info', title: '提示' })
  await markAllAsRead()
  const count = await getUnreadCount()
  assert.strictEqual(count, 0)
})

await test('deleteMessage: 删除消息', async () => {
  const msgs = await getMessages()
  assert.ok(msgs.length > 0)
  await deleteMessage(msgs[0].id)
  const after = await getMessages()
  assert.strictEqual(after.length, msgs.length - 1)
})

await test('getRechargeUrl: 各 provider 链接', () => {
  assert.ok(getRechargeUrl('deepseek').includes('deepseek'))
  assert.ok(getRechargeUrl('kimi').includes('moonshot'))
  assert.ok(getRechargeUrl('qwen').includes('aliyun'))
  assert.ok(getRechargeUrl('doubao').includes('volcengine'))
  assert.strictEqual(getRechargeUrl('unknown'), '')
})

// ── MainMemoryService ──────────────────────────────────────────────────────────
console.log('\n[MainMemoryService]')

// 重置路径缓存，确保使用新的 tmpDir
__resetMemoriesPath()

await test('MEMORY_TYPES 和 PRIORITY 常量存在', () => {
  assert.ok(MEMORY_TYPES.ARCHITECTURE_DECISION)
  assert.ok(MEMORY_TYPES.USER_PREFERENCE)
  assert.ok(PRIORITY.HIGH)
  assert.ok(PRIORITY.LOW)
})

await test('addMemory: 添加单条记忆', async () => {
  const r = await addMemory({
    type: MEMORY_TYPES.CODE_CONVENTION,
    title: '单向依赖',
    content: '上层只能 import 下层，禁止反向引用',
    keywords: ['依赖', '架构'],
    priority: PRIORITY.HIGH
  })
  assert.ok(r.success, r.error)
  assert.ok(r.data.id.startsWith('main_mem_'))
  assert.strictEqual(r.data.status, 'active')
})

await test('getAllMemories: 能读到刚添加的记忆', async () => {
  const r = await getAllMemories()
  assert.ok(r.success)
  assert.strictEqual(r.data.length, 1)
  assert.strictEqual(r.data[0].title, '单向依赖')
})

await test('addMemories: 批量添加', async () => {
  const r = await addMemories([
    { title: '批量1', content: '内容1', type: MEMORY_TYPES.TODO },
    { title: '批量2', content: '内容2', type: MEMORY_TYPES.KEY_UNDERSTANDING }
  ])
  assert.ok(r.success)
  assert.strictEqual(r.count, 2)
  const all = await getAllMemories()
  assert.strictEqual(all.data.length, 3)
})

await test('updateMemory: 更新记忆内容', async () => {
  const all = await getAllMemories()
  const id = all.data[0].id
  const r = await updateMemory(id, { title: '单向依赖（已更新）', priority: PRIORITY.MEDIUM })
  assert.ok(r.success)
  assert.strictEqual(r.data.title, '单向依赖（已更新）')
})

await test('deleteMemory: 删除记忆', async () => {
  const all = await getAllMemories()
  const id = all.data[all.data.length - 1].id
  const r = await deleteMemory(id)
  assert.ok(r.success)
  const after = await getAllMemories()
  assert.strictEqual(after.data.length, 2)
})

await test('retrieveMemories: 关键词检索', async () => {
  const r = await retrieveMemories('依赖架构')
  assert.ok(r.success)
  assert.ok(r.data.length >= 1)
  assert.ok(r.data[0].keywords.includes('依赖') || r.data[0].title.includes('依赖'))
})

await test('buildMemoryExtractionPrompt: 返回 systemPrompt 和 userPrompt', () => {
  const msgs = [
    { role: 'user', content: '我们决定用 L1/L2 分层架构' },
    { role: 'assistant', content: '好的，已记录' }
  ]
  const prompt = buildMemoryExtractionPrompt(msgs)
  assert.ok(typeof prompt.systemPrompt === 'string')
  assert.ok(typeof prompt.userPrompt === 'string')
  assert.ok(prompt.userPrompt.includes('L1/L2 分层架构'))
})

await test('parseAndSaveMemories: 解析 JSON 数组并保存', async () => {
  const json = JSON.stringify([{
    type: 'architecture_decision',
    title: 'L1 基座',
    content: '4 个 L1 包：llm-core/storage-core/config-core/shared-utils',
    keywords: ['L1', 'llm-core'],
    priority: 'high'
  }])
  const r = await parseAndSaveMemories(json, { conversationId: 'c-test' })
  assert.ok(r.success)
  assert.strictEqual(r.data.extracted, 1)
  assert.strictEqual(r.data.saved, 1)
})

await test('parseAndSaveMemories: 空数组返回 success + 0 条', async () => {
  const r = await parseAndSaveMemories('[]')
  assert.ok(r.success)
  assert.strictEqual(r.data.extracted, 0)
})

await test('parseAndSaveMemories: 支持 markdown 代码块格式', async () => {
  const mdJson = `\`\`\`json\n[{"type":"todo","title":"测试TODO","content":"内容"}]\n\`\`\``
  const r = await parseAndSaveMemories(mdJson)
  assert.ok(r.success)
  assert.strictEqual(r.data.saved, 1)
})

// ── 清理临时目录 ──────────────────────────────────────────────────────────────
await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

// ── 结果汇总 ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`)
console.log(`memory-store smoke: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  errors.forEach(({ name, err }) => console.error(`  FAIL: ${name}\n    ${err.stack || err.message}`))
  process.exit(1)
}
process.exit(0)

