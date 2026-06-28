/**
 * 配置管理（裁剪自 xingseq-develop/electron/data/configManager.js）
 *
 * 相对原版的差异：
 * 1. import 来源调整：getLogger / safeJsonParse 改自 @xingseq/shared-utils
 * 2. 解耦 cli/runtime.js：通过 helpers.getUserDataPath() 取 userData
 * 3. 解耦 systemModels.json 路径：通过 helpers.getSystemModelsPath() 注入
 * 4. 删去依赖 storage-core/database 的 saveCustomModelConfig/loadCustomModelConfig
 *    （等 storage-core 就绪后另设包/单独迁入）
 * 5. 删去反向依赖 tools/utils/security 的安全模式相关接口
 *    （init/saveAdvancedMode、init/saveUnrestrictedMode、saveAllowedExecutables、
 *     initAllowedExecutables），归 L3 安全管理服务
 *
 * @author Lioe Squieu
 * @originalCreated 2025-11-08
 * @migrated 2026 阶段 1.2
 */

import path from 'path'
import { promises as fs } from 'fs'
import { getLogger } from '@xingseq/shared-utils/logger'
import { safeJsonParse } from '@xingseq/shared-utils/jsonUtils'
import { getUserDataPath, getGlobalConfigPath, getSystemModelsPath } from './helpers.js'

const logger = getLogger('Config')

// 通用设置缓存
let _configCache = null
let _cacheTimestamp = 0
const CACHE_TTL = 3000

// ==================== 模型配置 ====================

export async function saveModelConfig(config) {
  try {
    const userDataPath = await getUserDataPath()
    const configDir = path.join(userDataPath, 'config')
    await fs.mkdir(configDir, { recursive: true })
    const configPath = path.join(configDir, 'models.json')
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
    logger.debug('模型配置已保存:', configPath)
    return { success: true }
  } catch (error) {
    logger.error('保存模型配置失败:', error)
    return { success: false, error: error.message }
  }
}

export async function loadModelConfig() {
  try {
    const userDataPath = await getUserDataPath()
    const appConfigPath = path.join(userDataPath, 'config', 'models.json')
    const globalConfigPath = path.join(getGlobalConfigPath(), 'models.json')

    // 两级查找：app 级优先，全局 fallback
    for (const configPath of [appConfigPath, globalConfigPath]) {
      try {
        const content = await fs.readFile(configPath, 'utf-8')
        const config = safeJsonParse(content, configPath)
        logger.debug('模型配置已加载:', configPath)
        return { success: true, data: config }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
    }

    // 两级均不存在，返回默认配置
    const defaultConfig = {
      models: [
        { id: 'deepseek-default', name: 'DeepSeek', provider: 'deepseek', apiKey: '', isDefault: true }
      ]
    }
    return { success: true, data: defaultConfig }
  } catch (error) {
    logger.error('加载模型配置失败:', error)
    return { success: false, error: error.message, data: { models: [] } }
  }
}

// ==================== API Key ====================

const PROVIDER_ENV_MAP = Object.freeze({
  deepseek: 'DEEPSEEK_API_KEY',
  kimi: 'KIMI_API_KEY',
  qwen: 'QWEN_API_KEY',
  doubao: 'DOUBAO_API_KEY'
})

/**
 * 优先级: 环境变量 > 配置文件中对应 provider 的默认模型 > 任意对应 provider 模型
 * 未知 provider 回退到 deepseek
 */
export async function getApiKeyByProvider(provider) {
  const normalized = PROVIDER_ENV_MAP[provider] ? provider : 'deepseek'
  const envName = PROVIDER_ENV_MAP[normalized]

  if (envName && process.env[envName]) return process.env[envName]

  try {
    const result = await loadModelConfig()
    if (result.success && result.data?.models) {
      const defaultModel = result.data.models.find(m => m.isDefault && m.provider === normalized)
        || result.data.models.find(m => m.provider === normalized)
      return defaultModel?.apiKey || null
    }
  } catch (e) {
    logger.warn(`获取 ${normalized} API Key 失败:`, e.message)
  }
  return null
}

export async function getDeepSeekApiKey() { return getApiKeyByProvider('deepseek') }
export async function getKimiApiKey()     { return getApiKeyByProvider('kimi') }
export async function getQwenApiKey()     { return getApiKeyByProvider('qwen') }
export async function getDoubaoApiKey()   { return getApiKeyByProvider('doubao') }

// ==================== 默认托底模型 ====================

export async function saveDefaultModel(config) {
  try {
    const generalResult = await loadGeneralConfig()
    const generalConfig = generalResult.success ? generalResult.data : {}
    generalConfig.defaultModel = {
      provider: config.provider || 'deepseek',
      subModel: config.subModel || null
    }
    return await saveGeneralConfig(generalConfig)
  } catch (error) {
    logger.error('保存默认托底模型配置失败:', error)
    return { success: false, error: error.message }
  }
}

export async function loadDefaultModel() {
  try {
    const result = await loadGeneralConfig()
    if (result.success && result.data?.defaultModel) {
      return { success: true, data: result.data.defaultModel }
    }
    return { success: true, data: { provider: 'deepseek', subModel: null } }
  } catch (error) {
    logger.error('读取默认托底模型配置失败:', error)
    return { success: true, data: { provider: 'deepseek', subModel: null } }
  }
}

// ==================== 通用设置（带 3s 缓存） ====================

const DEFAULT_GENERAL_CONFIG = Object.freeze({
  theme: 'system',
  language: 'zh-CN',
  workingDirectory: '',
  safeDirectories: [],
  allowedExecutables: [],
  tavilyApiKey: '',
  advancedMode: false,
  unrestrictedMode: false,
  useProxy: false,
  skillSetupComplete: false,
  toolCountdown: {
    enabled: false,
    seconds: 5,
    applyToTools: ['execute_command']
  }
})

export async function saveGeneralConfig(config) {
  try {
    const userDataPath = await getUserDataPath()
    const configDir = path.join(userDataPath, 'config')
    await fs.mkdir(configDir, { recursive: true })
    const configPath = path.join(configDir, 'general.json')
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
    _configCache = null
    _cacheTimestamp = 0
    logger.debug('通用设置已保存:', configPath)
    return { success: true }
  } catch (error) {
    logger.error('保存通用设置失败:', error)
    return { success: false, error: error.message }
  }
}

export async function loadGeneralConfig() {
  try {
    const now = Date.now()
    if (_configCache !== null && (now - _cacheTimestamp) < CACHE_TTL) {
      return { success: true, data: _configCache }
    }
    const userDataPath = await getUserDataPath()
    const configPath = path.join(userDataPath, 'config', 'general.json')
    try {
      const content = await fs.readFile(configPath, 'utf-8')
      const config = safeJsonParse(content, configPath)
      _configCache = config
      _cacheTimestamp = now
      return { success: true, data: config }
    } catch (err) {
      if (err.code === 'ENOENT') {
        const defaultConfig = { ...DEFAULT_GENERAL_CONFIG }
        _configCache = defaultConfig
        _cacheTimestamp = now
        return { success: true, data: defaultConfig }
      }
      throw err
    }
  } catch (error) {
    logger.error('加载通用设置失败:', error)
    return { success: false, error: error.message, data: { ...DEFAULT_GENERAL_CONFIG } }
  }
}

/**
 * 清除通用设置缓存（测试/热更新时使用）
 */
export function clearGeneralConfigCache() {
  _configCache = null
  _cacheTimestamp = 0
}

// ==================== 工作目录 ====================

export async function saveWorkingDirectory(workingDirectory) {
  try {
    const result = await loadGeneralConfig()
    const config = result.data || { theme: 'system', language: 'zh-CN' }
    config.workingDirectory = workingDirectory
    return await saveGeneralConfig(config)
  } catch (error) {
    logger.error('保存工作目录配置失败:', error)
    return { success: false, error: error.message }
  }
}

export async function loadWorkingDirectory() {
  try {
    const result = await loadGeneralConfig()
    return { success: true, data: result.data?.workingDirectory || '' }
  } catch (error) {
    logger.error('加载工作目录配置失败:', error)
    return { success: false, error: error.message, data: '' }
  }
}

// ==================== Tavily ====================

export async function getTavilyApiKey() {
  try {
    const result = await loadGeneralConfig()
    return result.data?.tavilyApiKey || ''
  } catch (error) {
    logger.error('获取 Tavily API Key 失败:', error)
    return ''
  }
}

// ==================== 代理开关（供 shared-utils proxyManager 注入） ====================

/**
 * 读取代理是否启用 —— 推荐在壳层启动时挂到
 *   setSharedEnv({ proxyEnabledReader: readProxyEnabled })
 * 让 shared-utils/proxyManager 自动拿到值。
 * @returns {Promise<boolean>}
 */
export async function readProxyEnabled() {
  try {
    const result = await loadGeneralConfig()
    return !!result.data?.useProxy
  } catch (error) {
    logger.error('读取代理开关失败:', error)
    return false
  }
}

// ==================== 系统模型只读配置 ====================

/**
 * 读取系统模型参数配置（只读，由生成器脚本生成）
 * 路径来自 setSharedEnv({ systemModelsPath })。未注入时返回空数组。
 */
export async function loadSystemModelConfig() {
  try {
    const configPath = getSystemModelsPath()
    if (!configPath) {
      logger.debug('未注入 systemModelsPath，返回空 systemModels')
      return { success: true, systemModels: [] }
    }
    try {
      const content = await fs.readFile(configPath, 'utf-8')
      const config = safeJsonParse(content, configPath)
      logger.debug('系统模型参数配置已加载')
      return { success: true, systemModels: config.systemModels || [] }
    } catch (err) {
      if (err.code === 'ENOENT') {
        logger.debug('系统模型参数配置文件不存在，请运行生成器脚本')
        return { success: true, systemModels: [] }
      }
      throw err
    }
  } catch (error) {
    logger.error('加载系统模型参数配置失败:', error)
    return { success: false, error: error.message, systemModels: [] }
  }
}

// ==================== 模型提供商子模型配置 ====================

const DEFAULT_PROVIDER_SUB_MODELS = {
  deepseek: {
    name: 'DeepSeek',
    subModels: [
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (日常对话)', isReasoner: false },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (深度推理)', isReasoner: true }
    ]
  },
  kimi: {
    name: 'Kimi (月之暗面)',
    subModels: [
      { value: 'moonshot-v1-8k', label: 'Moonshot V1 8K', isReasoner: false },
      { value: 'moonshot-v1-32k', label: 'Moonshot V1 32K', isReasoner: false },
      { value: 'moonshot-v1-128k', label: 'Moonshot V1 128K', isReasoner: false },
      { value: 'kimi-k2.5', label: 'Kimi K2.5 (全能)', isReasoner: true },
      { value: 'kimi-k2-thinking', label: 'Kimi K2 Thinking (深度思考)', isReasoner: true }
    ]
  },
  qwen: {
    name: '通义千问',
    subModels: [
      { value: 'qwen-turbo', label: 'Qwen Turbo (超高速)', isReasoner: false },
      { value: 'qwen-plus', label: 'Qwen Plus (推荐)', isReasoner: false },
      { value: 'qwen-max', label: 'Qwen Max (旗舰)', isReasoner: false },
      { value: 'qwen-long', label: 'Qwen Long (长文本)', isReasoner: false },
      { value: 'qwen-vl-plus', label: 'Qwen VL Plus (视觉)', isReasoner: false },
      { value: 'qwq-plus', label: 'QwQ Plus (深度推理)', isReasoner: true }
    ]
  },
  doubao: {
    name: '豆包 (火山方舟)',
    description: '豆包模型需要在火山方舟控制台创建接入点，子模型的 value 填写接入点 ID',
    subModels: [
      { value: 'doubao-1.5-pro-32k', label: 'Doubao 1.5 Pro 32K (推荐)', isReasoner: false },
      { value: 'doubao-1.5-pro-256k', label: 'Doubao 1.5 Pro 256K (旗舰)', isReasoner: true },
      { value: 'doubao-1.5-lite-32k', label: 'Doubao 1.5 Lite 32K (轻量)', isReasoner: false },
      { value: 'doubao-pro-128k', label: 'Doubao Pro 128K (长文本)', isReasoner: false },
      { value: 'doubao-lite-32k', label: 'Doubao Lite 32K (高性价比)', isReasoner: false },
      { value: 'doubao-seed-code', label: 'Doubao Seed Code (编程)', isReasoner: false }
    ]
  },
  openai: {
    name: 'OpenAI',
    subModels: [
      { value: 'gpt-4o', label: 'GPT-4o (最强)', isReasoner: true },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (快速)', isReasoner: false },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', isReasoner: false },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', isReasoner: false }
    ]
  }
}

export async function saveProviderSubModels(providers) {
  try {
    const userDataPath = await getUserDataPath()
    const configDir = path.join(userDataPath, 'config')
    await fs.mkdir(configDir, { recursive: true })
    const configPath = path.join(configDir, 'providerSubModels.json')
    await fs.writeFile(configPath, JSON.stringify(providers, null, 2), 'utf-8')
    logger.debug('模型提供商子模型配置已保存:', configPath)
    return { success: true }
  } catch (error) {
    logger.error('保存模型提供商子模型配置失败:', error)
    return { success: false, error: error.message }
  }
}

// ==================== 全局配置写入（供 llm-manager 使用） ====================

/**
 * 保存模型配置到全局路径 ~/.xingseq/config/models.json
 * 仅由 llm-manager 调用，其他应用只读
 */
export async function saveGlobalModelConfig(config) {
  try {
    const configDir = getGlobalConfigPath()
    await fs.mkdir(configDir, { recursive: true })
    const configPath = path.join(configDir, 'models.json')
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
    logger.debug('全局模型配置已保存:', configPath)
    return { success: true }
  } catch (error) {
    logger.error('保存全局模型配置失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 保存 Provider 子模型配置到全局路径 ~/.xingseq/config/providerSubModels.json
 * 仅由 llm-manager 调用，其他应用只读
 */
export async function saveGlobalProviderSubModels(providers) {
  try {
    const configDir = getGlobalConfigPath()
    await fs.mkdir(configDir, { recursive: true })
    const configPath = path.join(configDir, 'providerSubModels.json')
    await fs.writeFile(configPath, JSON.stringify(providers, null, 2), 'utf-8')
    logger.debug('全局 Provider 子模型配置已保存:', configPath)
    return { success: true }
  } catch (error) {
    logger.error('保存全局 Provider 子模型配置失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 保存默认模型到全局路径 ~/.xingseq/config/general.json
 * 仅由 llm-manager 调用
 */
export async function saveGlobalDefaultModel(config) {
  try {
    const configDir = getGlobalConfigPath()
    await fs.mkdir(configDir, { recursive: true })
    const configPath = path.join(configDir, 'general.json')
    let generalConfig = {}
    try {
      const content = await fs.readFile(configPath, 'utf-8')
      generalConfig = safeJsonParse(content, configPath)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    generalConfig.defaultModel = {
      provider: config.provider || 'deepseek',
      subModel: config.subModel || null
    }
    await fs.writeFile(configPath, JSON.stringify(generalConfig, null, 2), 'utf-8')
    logger.debug('全局默认模型配置已保存:', configPath)
    return { success: true }
  } catch (error) {
    logger.error('保存全局默认模型配置失败:', error)
    return { success: false, error: error.message }
  }
}

export async function loadProviderSubModels() {
  try {
    const userDataPath = await getUserDataPath()
    const appConfigPath = path.join(userDataPath, 'config', 'providerSubModels.json')
    const globalConfigPath = path.join(getGlobalConfigPath(), 'providerSubModels.json')

    // 两级查找：app 级优先，全局 fallback
    for (const configPath of [appConfigPath, globalConfigPath]) {
      try {
        const content = await fs.readFile(configPath, 'utf-8')
        const providers = safeJsonParse(content, configPath)
        // 补全 isReasoner 字段
        Object.entries(providers).forEach(([key, provider]) => {
          const defaultProvider = DEFAULT_PROVIDER_SUB_MODELS[key]
          if (defaultProvider && provider.subModels) {
            provider.subModels.forEach(model => {
              if (model.isReasoner === undefined) {
                const defaultModel = defaultProvider.subModels.find(m => m.value === model.value)
                model.isReasoner = defaultModel ? !!defaultModel.isReasoner : false
              }
            })
          }
        })
        logger.debug('Provider 子模型配置已加载:', configPath)
        return { success: true, data: providers }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
    }

    // 两级均不存在，落盘默认配置到全局路径
    const globalDir = getGlobalConfigPath()
    await fs.mkdir(globalDir, { recursive: true })
    await fs.writeFile(
      path.join(globalDir, 'providerSubModels.json'),
      JSON.stringify(DEFAULT_PROVIDER_SUB_MODELS, null, 2),
      'utf-8'
    )
    return { success: true, data: DEFAULT_PROVIDER_SUB_MODELS }
  } catch (error) {
    logger.error('加载模型提供商子模型配置失败:', error)
    return { success: false, error: error.message, data: DEFAULT_PROVIDER_SUB_MODELS }
  }
}

export { DEFAULT_GENERAL_CONFIG, DEFAULT_PROVIDER_SUB_MODELS, PROVIDER_ENV_MAP }
