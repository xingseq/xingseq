/**
 * @xingseq/chat-app
 * L4 应用：交互式对话（CLI + Web）
 *
 * 架构约定（与蓝图一致）：
 *   - 对话能力一律走 IChatProvider 接口（契约见 @xingseq/chat-core/IChatProvider.js）
 *   - 应用层只通过 createProvider() 拿 IChatProvider 实例，不直接 import 具体实现
 *   - 切换底层（chat-core ↔ ai-butler）= 改 ./provider.mjs，cli/server 零改动
 *
 * 入口文件：
 *   - src/cli.mjs        交互式 CLI（含 --live / --once / --workspace 等）
 *   - src/server.mjs     HTTP + SSE 服务（带 30s 倒计时确认弹窗）
 *   - src/provider.mjs   provider 工厂（type=chat-core|ai-butler）
 *   - web/               Vite + React 前端
 */

// ── provider 工厂（应用层应优先用这两个）
export { createProvider, resolveProviderType } from './provider.mjs'

// ── workspace 治理 + 工具 + 契约：直接透出 chat-core
export * from '@xingseq/chat-core'
/**
 * @xingseq/chat-app
 * L4 应用：交互式对话（CLI + Web）
 *
 * 引擎逻辑全部下沉到 @xingseq/chat-core，本包只保留入口：
 *   - src/cli.mjs     交互式 CLI（含 --live / --once / --workspace 等）
 *   - src/server.mjs  HTTP + SSE 服务（带 30s 倒计时确认弹窗）
 *   - web/            Vite + React 前端
 *
 * 仍 re-export chat-core 的核心 API，保持旧调用方零改动。
 */

export * from '@xingseq/chat-core'
/**
 * @xingseq/chat-app
 * L4 应用：开始对话（Chat）
 *
 * 串联 L1/L2 各包，实现一个可命令行使用的多轮对话应用：
 *   - shared-utils env 注入 (cli logger / userData)
 *   - config-core 取 API Key
 *   - llm-core executeChat 流式对话
 *   - tool-registry 工具注册 + 派发
 *   - workspaceStore 工作区级独立对话历史
 *
 * 工作区（workspace）是 chat-app 的一等概念：
 *   - 默认 workspace = <userData>/workspaces/default
 *   - 每个 workspace 自带 files/ 和 memory/，互相隔离
 *
 * 运行入口：bin/chat-app（即 src/cli.mjs）
 */

export {
  createChatSession,
  createWorkspaceRegistry,
  createDemoRegistry          // @deprecated 兼容别名
} from './chatSession.js'

export { runChatTurnWithTools } from './chatLoop.js'

export {
  DEMO_TOOLS,
  getTimeTool,
  readFileTool,
  listDirTool,
  createDemoHandlers
} from './tools.js'

export {
  resolveWorkspace,
  ensureWorkspace,
  listWorkspaces,
  DEFAULT_WORKSPACE_NAME
} from './workspace.js'

export { createWorkspaceStore } from './workspaceStore.js'
