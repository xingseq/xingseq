/**
 * storage-core smoke 测试
 *
 * 验证：
 * 1. atomicFile：异步/同步写入 + 父目录自动创建
 * 2. encryption：encrypt/decrypt 往返、generateSalt 长度、verifyPassword
 * 3. database：在临时 userData 下 initDatabase → INSERT → saveDatabase → 重新打开能读
 *    （会真去拉 sql.js wasm；首次 npm install 后能用）
 */

import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { setSharedEnv } from '@xingseq/shared-utils/env'

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

console.log('storage-core smoke')

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xingseq-storage-core-'))
const fakeApp = {
  getPath: (name) => {
    if (name === 'userData') return tmpRoot
    if (name === 'logs') return path.join(tmpRoot, 'logs')
    throw new Error(`unknown path: ${name}`)
  }
}
setSharedEnv({ getApp: async () => fakeApp })

const sc = await import('@xingseq/storage-core')

// ---------- 1. atomicFile ----------
await test('atomicWriteFile 写入 + 自动建父目录', async () => {
  const fp = path.join(tmpRoot, 'a', 'b', 'c.txt')
  await sc.atomicWriteFile(fp, 'hello')
  const content = await fs.readFile(fp, 'utf-8')
  assert.equal(content, 'hello')
})
await test('atomicWriteFileSync 同步写入', async () => {
  const fp = path.join(tmpRoot, 'sync.txt')
  sc.atomicWriteFileSync(fp, 'sync-ok')
  const content = await fs.readFile(fp, 'utf-8')
  assert.equal(content, 'sync-ok')
})

// ---------- 2. encryption ----------
await test('generateSalt 32 hex chars', () => {
  const s = sc.generateSalt()
  assert.equal(typeof s, 'string')
  assert.equal(s.length, 32)
})
await test('encrypt/decrypt 往返', () => {
  const salt = sc.generateSalt()
  const pwd = 'master-password-123'
  const plain = '机密：API Key sk-xxxxx'
  const enc = sc.encrypt(plain, pwd, salt)
  assert.notEqual(enc, plain)
  assert.equal(enc.split(':').length, 2)
  const dec = sc.decrypt(enc, pwd, salt)
  assert.equal(dec, plain)
})
await test('encrypt 空串 → 空串', () => {
  assert.equal(sc.encrypt('', 'p', 's'), '')
  assert.equal(sc.decrypt('', 'p', 's'), '')
})
await test('verifyPassword 正确/错误', () => {
  const salt = sc.generateSalt()
  const pwd = 'correct'
  const test = sc.generatePasswordTest(pwd, salt)
  assert.equal(sc.verifyPassword(pwd, test, salt), true)
  assert.equal(sc.verifyPassword('wrong', test, salt), false)
})
await test('decrypt 非法格式抛错', () => {
  assert.throws(() => sc.decrypt('not-valid-format', 'p', sc.generateSalt()), /解密失败/)
})

// ---------- 3. database ----------
await test('initDatabase 建表 + INSERT + 重新打开能读', async () => {
  sc.__resetForTest()
  const dbPath = path.join(tmpRoot, 'data', 'test.db')
  const db = await sc.initDatabase({ dbPath })
  // 默认 7 张表都已建好
  db.run("INSERT INTO conversations_global (id, title) VALUES ('t1', '测试对话')")
  await sc.saveDatabase()
  sc.__resetForTest()

  // 重新打开
  const db2 = await sc.initDatabase({ dbPath })
  const result = db2.exec("SELECT id, title FROM conversations_global WHERE id='t1'")
  assert.equal(result.length, 1)
  assert.equal(result[0].values[0][0], 't1')
  assert.equal(result[0].values[0][1], '测试对话')
  sc.closeDatabase()
})

await test('initDatabase 支持自定义 schemas', async () => {
  sc.__resetForTest()
  const dbPath = path.join(tmpRoot, 'data', 'custom.db')
  const db = await sc.initDatabase({
    dbPath,
    createStatements: [
      'CREATE TABLE IF NOT EXISTS smoke_only (id TEXT PRIMARY KEY, val TEXT)'
    ],
    alterStatements: []
  })
  db.run("INSERT INTO smoke_only VALUES ('x', 'y')")
  const r = db.exec("SELECT val FROM smoke_only WHERE id='x'")
  assert.equal(r[0].values[0][0], 'y')
  // 默认 7 张表不应存在
  assert.throws(() => db.exec('SELECT 1 FROM conversations_global'))
  sc.closeDatabase()
})

await test('getDatabasePath 使用最近一次 init 的路径', async () => {
  sc.__resetForTest()
  const dbPath = path.join(tmpRoot, 'data', 'pathtest.db')
  await sc.initDatabase({ dbPath })
  assert.equal(await sc.getDatabasePath(), dbPath)
  sc.closeDatabase()
})

// ---------- 清理 ----------
await fs.rm(tmpRoot, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
