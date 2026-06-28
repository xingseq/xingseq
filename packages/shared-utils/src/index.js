/**
 * @xingseq/shared-utils
 * L1 基座：logger / proxy / timestamp / 通用常量
 *
 * 已迁入（迁自原单体项目）：
 * - logger        相对原版去掉了对 cli/runtime.js 的硬依赖，改为通过 env.js 注入
 * - proxyManager  相对原版去掉了对 data/configManager.js 的硬依赖，改为 env.js 注入
 * - lazyLogger / logFormat / jsonUtils / timestamp / providerConstants  原样迁入
 *
 * 未迁入（不属于 L1 基座，留待后续阶段）：
 * - electronCompat.js   绑定 electron 包，归 electron-shell（阶段 4）
 * - capabilityLookup.js 硬编码项目根路径，归 electron-shell（阶段 4）
 * - encryption / atomicFile  归 storage-core（阶段 1.3）
 */

// 环境注入（壳层在启动时调用 setSharedEnv 接入实际环境）
export { setSharedEnv, getSharedEnv } from './env.js'

// 日志
export {
  initLogger,
  getLogger,
  setLogLevel,
  getLogPath,
  getCurrentLog
} from './logger.js'
export { default as log } from './logger.js'
export { createLazyLogger } from './lazyLogger.js'
export { formatForLog, default as formatForLogDefault } from './logFormat.js'

// 代理
export {
  isProxyEnabled,
  clearProxyCache,
  getSystemProxyUrl,
  getProxyUrl,
  buildSubAppEnvironment,
  logProxyStatus
} from './proxyManager.js'

// 时间戳
export {
  formatLocalTimestamp,
  formatLocalDate,
  formatLocalTimestampForFilename
} from './timestamp.js'

// JSON 工具
export {
  stripBOM,
  safeJsonParse,
  readJsonFile,
  writeJsonFile,
  readJsonFileSync
} from './jsonUtils.js'

// 常量
export {
  PROVIDER_DISPLAY_NAMES,
  getProviderDisplayName
} from './constants/providerConstants.js'
