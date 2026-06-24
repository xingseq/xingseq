/**
 * fsTools / shellTools handler 本地烟雾测试（不走 LLM）
 */

import { setSharedEnv } from '@xingseq/shared-utils/env'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

const SANDBOX = path.join(os.tmpdir(), `chat-app-fs-shell-${Date.now()}`)
await fs.mkdir(SANDBOX, { recursive: true })

setSharedEnv({
  isCLI: true,
  getApp: () => ({ getPath: () => path.join(os.homedir(), '.xingseq', 'chat-app') })
})

const { createFsHandlers, createShellHandlers } = await import('@xingseq/chat-core')

const fsH = createFsHandlers({ cwd: SANDBOX })
const shH = createShellHandlers({ cwd: SANDBOX })

let pass = 0
let fail = 0
function ok(name) { pass++; console.log(`  ✓ ${name}`) }
function bad(name, err) { fail++; console.error(`  ✗ ${name}: ${err?.message || err}`) }

async function expectThrow(fn, label) {
  try {
    await fn()
    bad(label, '应抛错但成功了')
  } catch (e) {
    ok(`${label} → ${e.message.slice(0, 60)}`)
  }
}

async function main() {
  // ── fs 测试 ───────────────────────────────────
  console.log('\n[fsTools]')
  try {
    const r = await fsH.set_file_content({ path: 'hello.txt', content: 'hello world' })
    if (r.size !== 11) bad('set_file_content size', r.size)
    else ok('set_file_content 写入')
  } catch (e) { bad('set_file_content', e) }

  await expectThrow(() => fsH.set_file_content({ path: '../escape.txt', content: 'x' }), 'set_file_content 越权 ../')
  await expectThrow(() => fsH.set_file_content({ path: '/etc/passwd', content: 'x' }), 'set_file_content 越权绝对路径')

  try {
    await fsH.set_file_content({ path: 'multi.md', content: '# A\nfoo\n# B\nfoo\n' })
    await expectThrow(
      () => fsH.replace_file_string({ path: 'multi.md', old_string: 'foo', new_string: 'bar' }),
      'replace_file_string 多次匹配'
    )
  } catch (e) { bad('多次匹配前置', e) }

  try {
    const r = await fsH.replace_file_string({
      path: 'hello.txt',
      old_string: 'hello world',
      new_string: 'hello xingseq'
    })
    if (r.replaced !== 1) bad('replace count', r.replaced)
    else {
      const after = await fs.readFile(path.join(SANDBOX, 'hello.txt'), 'utf-8')
      if (after !== 'hello xingseq') bad('replace 内容', after)
      else ok('replace_file_string 唯一替换')
    }
  } catch (e) { bad('replace', e) }

  try {
    await fsH.create_directory({ path: 'a/b/c' })
    const stat = await fs.stat(path.join(SANDBOX, 'a/b/c'))
    if (!stat.isDirectory()) bad('create_directory 类型', 'not dir')
    else ok('create_directory 递归')
  } catch (e) { bad('create_directory', e) }

  try {
    await fsH.set_file_content({ path: 'a/b/c/leaf.txt', content: 'leaf' })
    await expectThrow(
      () => fsH.delete_file({ path: 'a/b' }),
      'delete_file 非空目录默认拒绝'
    )
    await fsH.delete_file({ path: 'a/b/c/leaf.txt' })
    ok('delete_file 文件')
    await fsH.delete_file({ path: 'a/b', recursive: true })
    ok('delete_file 递归目录')
  } catch (e) { bad('delete_file', e) }

  await expectThrow(
    () => fsH.delete_file({ path: '.' }),
    'delete_file 工作区根目录'
  )

  // ── shell 测试 ────────────────────────────────
  console.log('\n[shellTools]')
  try {
    const r = await shH.execute_command({ command: 'echo', args: ['hello-shell'] })
    if (r.exit_code !== 0 || !r.stdout.includes('hello-shell')) {
      bad('echo', JSON.stringify(r))
    } else if (r.shellMode !== false) {
      bad('echo shellMode', r.shellMode)
    } else {
      ok('argv echo')
    }
  } catch (e) { bad('echo', e) }

  try {
    const r = await shH.execute_command({ command: 'ls', args: ['-1'] })
    if (r.exit_code !== 0) bad('ls', JSON.stringify(r))
    else ok(`argv ls (${r.stdout.split('\n').filter(Boolean).length} entries)`)
  } catch (e) { bad('ls', e) }

  await expectThrow(
    () => shH.execute_command({ command: 'curl', args: ['https://example.com'] }),
    'shell 白名单拒绝 curl'
  )

  try {
    // shell 元字符兜底：&& 触发 bash -c
    const r = await shH.execute_command({ command: 'echo a && echo b' })
    if (r.exit_code !== 0) bad('shell mode &&', JSON.stringify(r))
    else if (r.shellMode !== true) bad('shell mode 标志', r.shellMode)
    else if (!/a[\s\S]*b/.test(r.stdout)) bad('shell mode stdout', r.stdout)
    else ok('shell 元字符兜底 &&')
  } catch (e) { bad('shell mode', e) }

  await expectThrow(
    () => shH.execute_command({ command: 'ls', cwd: '../../../' }),
    'shell 越权 cwd'
  )
}

await main()

// ── 清理 ──────────────────────────────────────
await fs.rm(SANDBOX, { recursive: true, force: true })

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
