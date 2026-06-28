/**
 * @xingseq/chat-core 统一对外入口
 *
 * L3 对话引擎核心：所有需要 LLM 对话能力的 L4 应用都从此包消费。
 *
 * 架构原则：L3 三个包（llm-core / chat-core / agent）均实现同一个
 * IChatProvider 接口，从消费方视角等价：都是「给它消息，它回你内容」。
 * 详见 ./IChatProvider.js 契约。
 */

// 接口契约
export { IChatProviderContract } from './IChatProvider.js'

// ── 会话与工具循环 ───────────────────────────────────────────────────────────
export {
  createChatSession,
  createWorkspaceRegistry,
  createDemoRegistry // @deprecated 兼容别名
} from './chatSession.js'
export { runChatTurnWithTools } from './chatLoop.js'

// ── 执行轨迹（星序图原材料）──────────────────────────────────────────────────
export {
  TraceCollector,
  createTraceCollector,
  TRACE_EVENT_TYPES
} from './trace.js'

// ── workspace 一等公民 ───────────────────────────────────────────────────────
export {
  resolveWorkspace,
  ensureWorkspace,
  listWorkspaces,
  DEFAULT_WORKSPACE_NAME
} from './workspace.js'
export { createWorkspaceStore } from './workspaceStore.js'

// ── 安全模块 ────────────────────────────────────────────────────────────────
export {
  ALLOWED_COMMANDS,
  validateCommand,
  sanitizeCommandArgs,
  detectShellMeta,
  resolveSafePath,
  MAX_FILE_SIZE,
  MAX_COMMAND_TIMEOUT,
  DEFAULT_COMMAND_TIMEOUT
} from './security.js'

// ── 内置工具组（按需启用） ──────────────────────────────────────────────────
export {
  DEMO_TOOLS,
  getTimeTool,
  readFileTool,
  listDirTool,
  createDemoHandlers
} from './tools/workspace.js'
export { FS_TOOLS, createFsHandlers } from './tools/fs.js'
export { SHELL_TOOLS, createShellHandlers } from './tools/shell.js'
export { WEB_TOOLS, createWebHandlers } from './tools/web.js'
export { EMAIL_TOOLS, createEmailHandlers, createCliSendFn } from './tools/email.js'

// ── 邮件监听（MailGateway 使用） ─────────────────────────────────────────────
export { EmailMonitor } from './mail/EmailMonitor.js'
export { MockEmailMonitor } from './mail/MockEmailMonitor.js'
export * as VirtualMailboxStore from './mail/VirtualMailboxStore.js'

// ── 工具插件动态加载 ──
export { loadExternalTools, loadPlugin, discoverTools } from './toolLoader.js'
