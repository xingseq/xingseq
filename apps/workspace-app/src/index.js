/**
 * @xingseq/workspace-app
 * L4 应用：工作区操作助手
 *
 * 架构约定（与蓝图一致）：
 *   - 对话能力一律走 IChatProvider 接口（契约见 @xingseq/chat-core/IChatProvider.js）
 *   - 应用层只通过 createProvider() 拿 IChatProvider 实例，不直接 import 具体实现
 *   - 切换底层（chat-core ↔ agent）= 改 ./provider.mjs，cli/server 零改动
 *
 * 与 chat-app 的核心差异：
 *   - 支持挂载任意绝对路径作为工作区（chat-app 仅支持名称式）
 *   - 默认启用写工具（fs/shell），配合四层安全确认
 *   - UI 重心：文件树面板 + 对话
 *
 * 入口文件：
 *   - src/cli.mjs        交互式 CLI（含 --workspace-path 支持）
 *   - src/server.mjs     HTTP + SSE 服务（端口 3002）
 *   - src/provider.mjs   provider 工厂（type=chat-core|agent）
 *   - src/workspace.mjs  工作区解析（支持绝对路径挂载）
 *   - web/               Vite + React 前端
 */

// ── provider 工厂
export { createProvider, resolveProviderType } from './provider.mjs'

// ── workspace 解析（workspace-app 增强版，支持绝对路径）
export { resolveWorkspace, ensureWorkspace, listWorkspaces } from './workspace.mjs'
