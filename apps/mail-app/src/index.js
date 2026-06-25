/**
 * @xingseq/mail-app
 * L4 应用：邮件网关 + 邮件 CLI
 *
 * 功能：
 *   - gateway：常驻监听邮箱，收到邮件 → AI 处理 → 回复
 *   - send：通过 CLI 发送邮件（供其它工具/应用调用）
 *   - send-test：向虚拟邮箱投递测试邮件
 *   - once：单次对话测试
 *
 * 架构：
 *   - mail-app 是与 chat-app 平级的 L4 应用
 *   - 通过 @xingseq/chat-core 的 IChatProvider 接入 AI 能力
 *   - chat-app 的 send_email 工具通过调用 mail-app CLI 发邮件
 */

export { createProvider, resolveProviderType } from './provider.mjs'
export { sendEmail, loadMailConfig } from './send.mjs'
