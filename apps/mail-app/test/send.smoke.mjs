/**
 * mail-app send 烟雾测试（走真实 SMTP）
 *
 * 覆盖：
 *   1. 纯文本发送
 *   2. 带单附件发送（字符串路径 / 对象形式）
 *   3. 带多附件发送
 *   4. 参数校验（缺必填字段、附件文件不存在）
 *
 * 用法:
 *   node test/send.smoke.mjs                    # 全量（含真实发送）
 *   node test/send.smoke.mjs --dry              # 仅跑参数校验，不实际发邮件
 *   node test/send.smoke.mjs --to user@x.com   # 指定收件人
 */

import { sendEmail, loadMailConfig } from '../src/send.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ===== CLI 参数 =====
const args = process.argv.slice(2)
const isDry = args.includes('--dry')
const toIdx = args.indexOf('--to')
const TO = toIdx >= 0 ? args[toIdx + 1] : 'tian_su@qq.com'

// ===== 测试基础设施 =====
let pass = 0
let fail = 0
function ok(name) { pass++; console.log(`  ✓ ${name}`) }
function bad(name, err) { fail++; console.error(`  ✗ ${name}: ${err}`) }

// ===== 准备测试附件 =====
const TMP_DIR = path.join(os.tmpdir(), 'mail-app-smoke')
fs.mkdirSync(TMP_DIR, { recursive: true })

const ATT_1 = path.join(TMP_DIR, 'hello.txt')
fs.writeFileSync(ATT_1, `mail-app smoke test\n生成时间: ${new Date().toISOString()}\n`)

const ATT_2 = path.join(TMP_DIR, 'data.json')
fs.writeFileSync(ATT_2, JSON.stringify({ test: true, ts: Date.now() }, null, 2))

// ===== 测试用例 =====

async function testMissingParams() {
  console.log('\n[参数校验]')

  const r1 = await sendEmail({})
  r1.success ? bad('空参数应失败', '返回 success') : ok('空参数 → 报错')

  const r2 = await sendEmail({ to: 'a@b.c', subject: 'x' })
  r2.success ? bad('缺body应失败', '返回 success') : ok('缺 body → 报错')

  const r3 = await sendEmail({ to: 'a@b.c', body: 'x' })
  r3.success ? bad('缺subject应失败', '返回 success') : ok('缺 subject → 报错')
}

async function testSmtpConfig() {
  console.log('\n[SMTP 配置]')
  const config = loadMailConfig()
  if (!config.smtp?.auth?.user || !config.smtp?.auth?.pass) {
    bad('SMTP 配置', '未配置 user/pass，后续真实发送用例将跳过')
    return false
  }
  ok(`SMTP 已配置: ${config.smtp.host}:${config.smtp.port} user=${config.smtp.auth.user}`)
  return true
}

async function testSendPlainText() {
  console.log('\n[纯文本发送]')
  const r = await sendEmail({
    to: TO,
    subject: `[smoke] 纯文本测试 ${new Date().toLocaleTimeString()}`,
    body: '这是 mail-app send.smoke 的纯文本测试邮件。'
  })
  if (r.success) {
    ok(`纯文本 → ${TO} (messageId=${r.messageId})`)
  } else {
    bad('纯文本发送', r.error)
  }
}

async function testSendWithAttachment() {
  console.log('\n[单附件发送 - 对象形式]')
  const r = await sendEmail({
    to: TO,
    subject: `[smoke] 单附件测试 ${new Date().toLocaleTimeString()}`,
    body: '本邮件包含一个 txt 附件。',
    attachments: [{ path: ATT_1, filename: '测试附件.txt' }]
  })
  if (r.success) {
    ok(`单附件(对象) → ${TO} (messageId=${r.messageId})`)
  } else {
    bad('单附件发送', r.error)
  }
}

async function testSendWithStringAttachment() {
  console.log('\n[单附件发送 - 字符串路径]')
  const r = await sendEmail({
    to: TO,
    subject: `[smoke] 字符串附件测试 ${new Date().toLocaleTimeString()}`,
    body: '本邮件使用字符串路径指定附件。',
    attachments: [ATT_1]
  })
  if (r.success) {
    ok(`单附件(字符串) → ${TO} (messageId=${r.messageId})`)
  } else {
    bad('单附件(字符串)', r.error)
  }
}

async function testSendMultipleAttachments() {
  console.log('\n[多附件发送]')
  const r = await sendEmail({
    to: TO,
    subject: `[smoke] 多附件测试 ${new Date().toLocaleTimeString()}`,
    body: '本邮件包含两个附件：txt + json。',
    attachments: [
      { path: ATT_1, filename: '说明.txt' },
      { path: ATT_2, filename: '数据.json' }
    ]
  })
  if (r.success) {
    ok(`多附件(2个) → ${TO} (messageId=${r.messageId})`)
  } else {
    bad('多附件发送', r.error)
  }
}

async function testNonExistentAttachment() {
  console.log('\n[不存在的附件文件]')
  const r = await sendEmail({
    to: TO,
    subject: '[smoke] 不存在附件',
    body: '这封邮件附件路径不存在，应发送失败。',
    attachments: [{ path: '/tmp/does_not_exist_12345.bin' }]
  })
  if (!r.success) {
    ok(`不存在附件 → 正确报错: ${r.error.slice(0, 80)}`)
  } else {
    bad('不存在附件应失败', `意外成功 messageId=${r.messageId}`)
  }
}

// ===== 主流程 =====
async function main() {
  console.log('=== mail-app send 烟雾测试 ===')
  console.log(`  收件人: ${TO}`)
  console.log(`  模式: ${isDry ? 'dry（仅校验）' : 'live（真实发送）'}`)

  // 始终执行的参数校验
  await testMissingParams()

  // SMTP 配置检查
  const smtpOk = await testSmtpConfig()

  if (isDry) {
    console.log('\n[dry 模式] 跳过真实发送用例')
  } else if (!smtpOk) {
    console.log('\n[跳过] SMTP 未配置，无法执行真实发送')
  } else {
    await testSendPlainText()
    await testSendWithAttachment()
    await testSendWithStringAttachment()
    await testSendMultipleAttachments()
    await testNonExistentAttachment()
  }

  // 清理临时文件
  fs.rmSync(TMP_DIR, { recursive: true, force: true })

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('FATAL', e)
  process.exit(1)
})
