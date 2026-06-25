#!/usr/bin/env node
/**
 * mail-app CLI - 邮件应用命令行入口
 *
 * 子命令：
 *   gateway [--mock|--dry]              启动邮件网关（常驻监听）
 *   send --to --subject --body          发送一封邮件（供其它工具/应用调用）
 *   send-test [message]                 向虚拟邮箱投递测试邮件
 *   once [--dry] <message>              单次 AI 对话测试
 *
 * 示例：
 *   node src/cli.mjs gateway --mock
 *   node src/cli.mjs send --to user@example.com --subject "Hello" --body "Hi there"
 *   node src/cli.mjs send-test "你好"
 *   node src/cli.mjs once --dry 帮我查一下时间
 */

const args = process.argv.slice(2)
const subcommand = args[0] || 'gateway'

switch (subcommand) {
  case 'gateway':
    await import('./gateway.mjs')
    break

  case 'send':
    await runSend()
    break

  case 'send-test':
    await runSendTest()
    break

  case 'once':
    await runOnce()
    break

  case '--help':
  case '-h':
    showHelp()
    break

  default:
    // 如果第一个参数不是子命令，当作 gateway 的参数
    if (subcommand.startsWith('--')) {
      await import('./gateway.mjs')
    } else {
      console.error(`[mail-app] 未知子命令: ${subcommand}`)
      showHelp()
      process.exit(1)
    }
}

// ===== send 子命令 =====
async function runSend() {
  const { sendEmail } = await import('./send.mjs')

  function readArg(name) {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : null
  }

  const to = readArg('--to')
  const subject = readArg('--subject')
  const body = readArg('--body')
  const attachmentsRaw = readArg('--attachments')

  if (!to || !subject || !body) {
    console.error(JSON.stringify({
      success: false,
      error: '缺少参数。用法: mail-app send --to <email> --subject <subject> --body <body>'
    }))
    process.exit(1)
  }

  let attachments = undefined
  if (attachmentsRaw) {
    try {
      attachments = JSON.parse(attachmentsRaw)
    } catch {
      console.error(JSON.stringify({
        success: false,
        error: '--attachments 必须是合法 JSON 数组'
      }))
      process.exit(1)
    }
  }

  const result = await sendEmail({ to, subject, body, attachments })

  // 输出 JSON 结果（供调用方解析）
  console.log(JSON.stringify(result))
  process.exit(result.success ? 0 : 1)
}

// ===== send-test 子命令 =====
async function runSendTest() {
  const { setSharedEnv } = await import('@xingseq/shared-utils/env')
  const path = await import('node:path')
  const os = await import('node:os')
  const fs = await import('node:fs')

  const userData = path.join(os.homedir(), '.xingseq', 'mail-app')
  fs.mkdirSync(userData, { recursive: true })

  setSharedEnv({
    isCLI: true,
    importers: {
      cliLogger: () => import('electron-log/node.js').catch(() => ({ default: console }))
    },
    getApp: () => ({
      getPath: () => userData,
      isReady: () => true,
      whenReady: async () => {}
    }),
    systemModelsPath: null
  })

  const { VirtualMailboxStore } = await import('@xingseq/chat-core')
  const { loadMailConfig } = await import('./send.mjs')

  const mailConfig = loadMailConfig()
  const testContent = args.slice(1).filter(a => !a.startsWith('--')).join(' ') || '这是一封测试邮件'
  const account = mailConfig.email || 'assistant@test.local'
  const sender = mailConfig.senderFilter || 'user@test.local'

  await VirtualMailboxStore.deliver({
    from: sender,
    to: account,
    subject: '测试邮件',
    content: testContent
  })

  console.log(`[mail-app] 测试邮件已投递: ${sender} → ${account}`)
  console.log(`  主题: 测试邮件`)
  console.log(`  内容: ${testContent}`)
  process.exit(0)
}

// ===== once 子命令 =====
async function runOnce() {
  // 移除 'once' 后重新组装参数传给 gateway（once 模式）
  const onceArgs = args.slice(1)
  // 注入 --once 标志让 gateway 处理
  process.argv = [process.argv[0], process.argv[1], '--once', ...onceArgs]
  await import('./gateway.mjs')
}

// ===== help =====
function showHelp() {
  console.log(`
mail-app - 星序邮件应用

用法:
  mail-app <command> [options]

子命令:
  gateway [--mock|--dry]                     启动邮件网关（默认）
  send --to <email> --subject <s> --body <b> 发送邮件
  send-test [message]                        投递测试邮件到虚拟邮箱
  once [--dry] <message>                     单次 AI 对话测试

选项:
  --mock    使用虚拟邮箱 + 真实 LLM
  --dry     使用虚拟邮箱 + mock LLM（完全离线测试）
  --help    显示帮助
`)
}
