/**
 * @xingseq/chat-app
 * L4 应用：开始对话（Chat）
 *
 * 串联 L1/L2 各包，实现一个可命令行使用的多轮对话应用：
 *   - shared-utils env 注入 (cli logger / userData)
 *   - config-core 取 API Key
 *   - llm-core executeChat 流式对话
 *   - tool-registry 工具注册 + 派发
 *   - memory-store 对话索引 + 完整文件保存/读取
 *
 * 运行入口：bin/chat-app（即 src/cli.mjs）
 */

export { createChatSession, createDemoRegistry } from './chatSession.js'
export { runChatTurnWithTools } from './chatLoop.js'
export {
  DEMO_TOOLS,
  getTimeTool,
  readFileTool,
  listDirTool,
  createDemoHandlers
} from './tools.js'
