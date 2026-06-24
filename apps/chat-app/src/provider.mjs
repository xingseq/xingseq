/**
 * chat-app provider 工厂层
 *
 * L4 应用层在这里取 IChatProvider 实例 —— 应用代码只依赖
 * IChatProvider 接口，不直接 import 具体实现（createChatSession / createAIButler）。
 *
 * 这样做的价值：
 *   - 切换底层实现（chat-core ↔ ai-butler）= 改这一个文件，应用层零改动
 *   - cli.mjs / server.mjs 里的类型声明只标 IChatProvider，不绑死实现
 *   - 未来 workspace-app / chatroom-app 复用同一份 provider 工厂
 *
 * 当前支持：
 *   - 'chat-core' (默认)：单实例 + 工具循环 + workspace
 *   - 'ai-butler'        ：多角色协调 Agent（计划中，L3 ai-butler 完成后接入）
 *
 * 切换方式：
 *   - 函数参数：createProvider({ type: 'ai-butler', ... })
 *   - 环境变量：XINGSEQ_PROVIDER=ai-butler node src/cli.mjs
 *
 * 契约文档：see @xingseq/chat-core/src/IChatProvider.js
 */

import { createChatSession } from '@xingseq/chat-core'

const SUPPORTED = new Set(['chat-core', 'ai-butler'])

/**
 * 当前生效的 provider 类型（显式参数 > 环境变量 > 默认 chat-core）
 *
 * @param {string} [explicit] 显式指定类型
 * @returns {string}
 */
export function resolveProviderType(explicit) {
  return explicit || process.env.XINGSEQ_PROVIDER || 'chat-core'
}

/**
 * 创建一个 IChatProvider 实例
 *
 * @param {object} opts
 * @param {object} opts.workspace          workspace 描述（resolveWorkspace 的产物）
 * @param {object} opts.registry           工具注册表（createWorkspaceRegistry 的产物）
 * @param {string} [opts.id]               对话 ID（用于恢复历史）
 * @param {string} [opts.type]             provider 类型，默认读 XINGSEQ_PROVIDER 或 'chat-core'
 * @returns {import('@xingseq/chat-core').IChatProvider}
 */
export function createProvider(opts = {}) {
  const type = resolveProviderType(opts.type)

  if (!SUPPORTED.has(type)) {
    throw new Error(
      `[chat-app] 未知 provider 类型: "${type}"。可选: ${[...SUPPORTED].join(', ')}`
    )
  }

  if (type === 'ai-butler') {
    throw new Error(
      `[chat-app] provider "ai-butler" 尚未接入（L3 ai-butler 仍是脚手架）。` +
      `请暂时使用 "chat-core"，或等 ai-butler 完成后再切。`
    )
  }

  // type === 'chat-core'
  return createChatSession({
    id: opts.id,
    workspace: opts.workspace,
    registry: opts.registry
  })
}
