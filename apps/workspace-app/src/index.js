/**
 * @xingseq/workspace-app
 * L4 应用：开始操作（WorkspaceChat）
 *
 * 阶段 0 脚手架占位入口，按拆分计划在对应阶段迁入实际实现。
 *
 * ── 架构约定（提前锁定，避免后续返工）
 *
 *   workspace-app 与 chat-app 一致，对话能力一律走 IChatProvider 接口：
 *
 *     import { createProvider } from './provider.mjs'
 *
 *     /** @type {import('@xingseq/chat-core').IChatProvider} *\/
 *     const session = createProvider({ workspace, registry })
 *
 *   - 默认走 chat-core；后续 ai-butler 接入后改 provider.mjs 即可，应用代码不动
 *   - 契约文档：@xingseq/chat-core/src/IChatProvider.js
 *   - 参考实现：apps/chat-app/src/provider.mjs
 */
export const __scaffold__ = true
