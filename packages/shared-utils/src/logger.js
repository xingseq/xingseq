/**
 * 统一日志管理 - 基于 electron-log
 * 支持 Electron 主进程与 CLI 双模式。
 *
 * 注：原版直接 import '../cli/runtime.js'，分包后改由 env.js 注入。
 * 见 env.js 中的 SharedEnv 类型定义。
 */
import path from 'path'
import { getSharedEnv } from './env.js'

const LOG_LEVELS = ['error', 'warn', 'info', 'verbose', 'debug', 'silly']

let log = null
let initialized = false

/**
 * 初始化日志配置
 * @param {Object} options
 * @param {string} [options.level='info']
 * @param {boolean} [options.console=true]
 * @param {boolean} [options.file=true]
 * @param {number} [options.maxSize=10485760]
 */
export async function initLogger(options = {}) {
  if (initialized && log) return log

  const {
    level = 'info',
    console: enableConsole = true,
    file: enableFile = true,
    maxSize = 10 * 1024 * 1024
  } = options

  const env = getSharedEnv()

  if (env.isCLI) {
    // CLI 模式：由壳层注入 CLILogger 工厂
    if (!env.importers?.cliLogger) {
      throw new Error('[shared-utils/logger] CLI 模式下需通过 setSharedEnv({ importers:{ cliLogger } }) 注入 CLILogger 工厂')
    }
    const { default: cliLog, initCLILogger } = await env.importers.cliLogger()
    const app = env.getApp ? await env.getApp() : null
    const logPath = app
      ? (app.getPath('logs') || path.join(app.getPath('userData'), 'logs'))
      : path.join(process.cwd(), 'logs')

    initCLILogger({ level, console: enableConsole, file: enableFile, logPath })
    log = cliLog
  } else {
    // Electron 主进程模式：动态加载 electron-log
    const importer = env.importers?.electronLog || (() => import('electron-log/main.js'))
    const electronLog = await importer()
    log = electronLog.default

    let logPath = null
    if (env.getApp) {
      const app = await env.getApp()
      const userDataPath = app.getPath('userData')
      logPath = path.join(userDataPath, 'logs')
    }

    if (enableFile && logPath) {
      log.transports.file.level = level
      log.transports.file.maxSize = maxSize
      log.transports.file.resolvePathFn = () => path.join(logPath, 'main.log')
      log.transports.file.archiveLogFn = (oldLogFile) => {
        const info = path.parse(oldLogFile)
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        return path.join(info.dir, `${info.name}-${timestamp}${info.ext}`)
      }
    } else {
      log.transports.file.level = false
    }

    if (enableConsole) {
      log.transports.console.level = level
      log.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'
    } else {
      log.transports.console.level = false
    }

    log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'
    log.errorHandler?.startCatching?.()
  }

  initialized = true
  log.info('日志系统初始化完成', { level })
  return log
}

/**
 * 获取日志实例（可指定 scope）
 * 系统未初始化时返回 fallback（console 回退）
 * @param {string} [scope]
 */
export function getLogger(scope) {
  if (!log) return createFallbackLogger(scope)
  if (scope) return log.scope(scope)
  return log
}

function createFallbackLogger(scope) {
  const prefix = scope ? `[${scope}]` : ''
  return {
    error: (...args) => console.error(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    info: (...args) => console.log(prefix, ...args),
    verbose: (...args) => console.log(prefix, ...args),
    debug: (...args) => console.log(prefix, ...args),
    silly: (...args) => console.log(prefix, ...args),
    log: (...args) => console.log(prefix, ...args),
    scope: (newScope) => createFallbackLogger(`${scope}:${newScope}`)
  }
}

/**
 * 设置日志级别
 */
export function setLogLevel(level) {
  if (!log) return
  if (LOG_LEVELS.includes(level)) {
    if (log.transports) {
      log.transports.file.level = level
      log.transports.console.level = level
    }
    log.info(`日志级别已更改为: ${level}`)
  }
}

/**
 * 获取日志文件路径
 */
export function getLogPath() {
  if (!log || !log.transports) return ''
  return log.transports.file.getFile?.()?.path || ''
}

/**
 * 获取当前日志实例
 */
export function getCurrentLog() {
  return log
}

// 延迟解析的代理对象，作为默认导出
const logProxy = new Proxy({}, {
  get(_target, prop) {
    if (log) {
      return typeof log[prop] === 'function' ? log[prop].bind(log) : log[prop]
    }
    const fallback = createFallbackLogger(null)
    return fallback[prop]
  }
})

export default logProxy
