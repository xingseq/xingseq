/**
 * mail-app provider 工厂层
 *
 * 与 chat-app/provider.mjs 相同模式：
 * 通过 IChatProvider 接口取实例，不绑死具体实现。
 */

import { createChatSession } from '@xingseq/chat-core'

const SUPPORTED = new Set(['chat-core', 'ai-butler'])

export function resolveProviderType(explicit) {
  return explicit || process.env.XINGSEQ_PROVIDER || 'chat-core'
}

export function createProvider(opts = {}) {
  const type = resolveProviderType(opts.type)

  if (!SUPPORTED.has(type)) {
    throw new Error(`[mail-app] 未知 provider 类型: "${type}"。可选: ${[...SUPPORTED].join(', ')}`)
  }

  if (type === 'ai-butler') {
    throw new Error(`[mail-app] provider "ai-butler" 尚未接入。请使用 "chat-core"。`)
  }

  return createChatSession({
    id: opts.id,
    workspace: opts.workspace,
    registry: opts.registry
  })
}
