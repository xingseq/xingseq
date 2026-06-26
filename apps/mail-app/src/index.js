/**
 * @xingseq/mail-app
 * L4 应用：邮件网关 + 邮件 CLI
 *
 * 功能：
 *   - gateway：常驻监听邮箱，收到邮件 → 调 chat-app AI 处理 → 回复
 *   - send：通过 CLI 发送邮件（供其它工具/应用调用）
 *   - send-test：向虚拟邮箱投递测试邮件
 *   - once：单次对话测试
 *
 * 架构：
 *   - mail-app 是与 chat-app 平级的 L4 应用
 *   - 通过 chatClient 调 chat-app CLI/SSE 接入 AI 能力（不直接管理 LLM/API Key）
 *   - chat-app 的 send_email 工具通过调用 mail-app CLI 发邮件
 */

export { sendEmail, loadMailConfig } from './send.mjs'
export { chatWithAssistant, chatViaCli, chatViaSse, getConversationId } from './chatClient.mjs'
