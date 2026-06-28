/**
 * @xingseq/llm-manager
 * L4 应用：LLM 模型配置管理中心
 *
 * 职责：
 * - 管理全局 LLM 模型配置（~/.xingseq/config/models.json）
 * - 管理 Provider 子模型列表
 * - 默认模型选择
 * - API Key 连通性测试
 *
 * 架构约定：
 * - 全局配置写入走 config-core 的 saveGlobalModelConfig / saveGlobalProviderSubModels
 * - 其他 L4 应用通过 config-core 的两级 fallback 读取全局配置
 * - 未来集成到 electron-shell 作为内嵌 tab/panel
 */

export { startServer } from './server.mjs'
