/**
 * @xingseq/config-core
 * L1 基座：通用配置 / 模型配置 / API Key 取值
 *
 * 已迁入（裁剪自 electron/data/configManager.js）：
 * - 模型配置：saveModelConfig / loadModelConfig
 * - API Key：getApiKeyByProvider + 4 个 provider 别名
 * - 通用设置（含 3s 缓存）：save/loadGeneralConfig、clearGeneralConfigCache
 * - 默认托底模型：save/loadDefaultModel
 * - 工作目录：save/loadWorkingDirectory
 * - Tavily API Key：getTavilyApiKey
 * - 代理开关读取：readProxyEnabled（供 shared-utils 注入）
 * - 系统模型只读：loadSystemModelConfig（路径从 env.systemModelsPath 取）
 * - Provider 子模型：save/loadProviderSubModels（含默认表）
 *
 * 未迁入（延后阶段）：
 * - saveCustomModelConfig / loadCustomModelConfig（依赖 sqlite，待 storage-core）
 * - init/saveAdvancedMode / init/saveUnrestrictedMode / saveAllowedExecutables / initAllowedExecutables
 *   （反向依赖 tools/utils/security，归 L3 安全管理）
 */

export {
  // 模型配置
  saveModelConfig,
  loadModelConfig,
  // API Key
  getApiKeyByProvider,
  getDeepSeekApiKey,
  getKimiApiKey,
  getQwenApiKey,
  getDoubaoApiKey,
  PROVIDER_ENV_MAP,
  // 默认托底模型
  saveDefaultModel,
  loadDefaultModel,
  // 通用设置
  saveGeneralConfig,
  loadGeneralConfig,
  clearGeneralConfigCache,
  DEFAULT_GENERAL_CONFIG,
  // 工作目录
  saveWorkingDirectory,
  loadWorkingDirectory,
  // Tavily
  getTavilyApiKey,
  // 代理开关读取（供 shared-utils 注入）
  readProxyEnabled,
  // 系统模型只读
  loadSystemModelConfig,
  // Provider 子模型
  saveProviderSubModels,
  loadProviderSubModels,
  DEFAULT_PROVIDER_SUB_MODELS
} from './configManager.js'

export { getUserDataPath, getSystemModelsPath } from './helpers.js'
