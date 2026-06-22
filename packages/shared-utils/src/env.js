/**
 * shared-utils 环境注入点
 *
 * 解耦原因：原 electron/utils/logger.js 与 proxyManager.js 直接 import 了壳层模块
 * （cli/runtime.js、data/configManager.js）。在分包后，shared-utils 不应反向依赖
 * 上层包。改为由壳层（electron-shell / cli runtime / 业务包）在启动期调用
 * setSharedEnv() 把"环境探针"注入进来。
 *
 * 未注入时，shared-utils 依然可用（仅退化到 fallback console 日志、代理默认关闭）。
 */

/**
 * @typedef {Object} SharedEnv
 * @property {boolean} isCLI - 是否运行在 CLI 模式（影响 logger 后端选择）
 * @property {() => Promise<{getPath:(name:string)=>string}>} [getApp]
 *   返回类 electron.app 对象，至少实现 getPath('logs'|'userData')。
 *   未提供时 file transport 退化为关闭。
 * @property {() => Promise<boolean>} [proxyEnabledReader]
 *   读取“代理是否开启”的异步函数。未提供时默认 false。
 * @property {string|null} [systemModelsPath]
 *   系统模型只读配置文件的绝对路径（原 electron/config/systemModels.json）。
 *   未提供时 config-core 的 loadSystemModelConfig 返回空数组。
 * @property {Object} [importers]
 * @property {() => Promise<{default:any, initCLILogger?:Function}>} [importers.cliLogger]
 *   CLI 模式下用于动态导入 CLILogger 模块的工厂。未提供且 isCLI=true 时报错。
 * @property {() => Promise<any>} [importers.electronLog]
 *   非 CLI 模式下用于导入 electron-log 主进程入口的工厂。默认 () => import('electron-log/main.js')
 */

/** @type {SharedEnv} */
let _env = {
  isCLI: false,
  getApp: null,
  proxyEnabledReader: async () => false,
  systemModelsPath: null,
  importers: {
    cliLogger: null,
    electronLog: () => import('electron-log/main.js')
  }
}

/**
 * 注入/合并环境配置
 * @param {Partial<SharedEnv>} patch
 */
export function setSharedEnv(patch) {
  if (!patch) return
  _env = {
    ..._env,
    ...patch,
    importers: { ..._env.importers, ...(patch.importers || {}) }
  }
}

/**
 * 读取当前环境配置
 * @returns {SharedEnv}
 */
export function getSharedEnv() {
  return _env
}
