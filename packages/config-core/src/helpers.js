/**
 * config-core 内部辅助
 *
 * 通过 shared-utils 的 env 注入点解析 userDataPath，避免反向依赖壳层
 * （原版 configManager.js 中是 `import { app } from '../cli/runtime.js'`）。
 */
import path from 'path'
import os from 'os'
import { getSharedEnv } from '@xingseq/shared-utils/env'

/**
 * 获取 userData 路径（异步，因为 getApp 是异步的）
 * @returns {Promise<string>}
 * @throws 当未注入 getApp 时抛错
 */
export async function getUserDataPath() {
  const env = getSharedEnv()
  if (!env.getApp) {
    throw new Error('[config-core] 未注入 getApp，请在壳层启动时调用 setSharedEnv({ getApp })')
  }
  const app = await env.getApp()
  return app.getPath('userData')
}

/**
 * 获取全局共享配置目录路径（所有应用通用）
 * 路径固定为 ~/.xingseq/config/，由 llm-manager 统一写入和管理
 * @returns {string}
 */
export function getGlobalConfigPath() {
  return path.join(os.homedir(), '.xingseq', 'config')
}

/**
 * 获取系统模型只读配置文件路径
 * @returns {string|null}
 */
export function getSystemModelsPath() {
  return getSharedEnv().systemModelsPath || null
}
