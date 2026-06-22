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
