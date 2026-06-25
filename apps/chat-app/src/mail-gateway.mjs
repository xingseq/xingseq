#!/usr/bin/env node
/**
 * @deprecated 邮件网关已迁移到 @xingseq/mail-app
 *
 * 请使用：
 *   cd apps/mail-app && npm start          # 启动网关
 *   npx mail-app send --to ... --subject ... --body ...  # 发邮件
 *
 * 此文件保留为兼容重定向，会自动调用 mail-app gateway。
 */

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mailAppCli = path.resolve(__dirname, '../../mail-app/src/cli.mjs')

console.warn('[chat-app] ⚠️  mail-gateway 已迁移到 @xingseq/mail-app')
console.warn(`[chat-app] 正在转发到: node ${mailAppCli} gateway ...`)
console.warn('')

try {
  execFileSync('node', [mailAppCli, 'gateway', ...process.argv.slice(2)], {
    stdio: 'inherit'
  })
} catch (err) {
  if (err.status != null) process.exit(err.status)
  throw err
}
