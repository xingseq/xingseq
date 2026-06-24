/**
 * 工具确认机制（依赖注入版）
 *
 * 与原 electron/tools/toolConfirmation.js 等价能力，但移除了对 electron / configManager / windowManager 的直接 import。
 * 所有平台依赖（弹窗、IPC、配置读取）由上层在 createConfirmationManager 时注入。
 *
 * 默认敏感工具列表与 develop 保持一致，可通过 sensitiveTools 覆盖。
 */

import { getLogger } from '@xingseq/shared-utils/logger'

const logger = getLogger('ToolConfirmation')

export const DEFAULT_SENSITIVE_TOOLS = [
  'set_file_content',
  'replace_file_string',
  'copy_file',
  'move_file',
  'execute_command',
  'launch_application',
  'insert_record',
  'update_record',
  'delete_record',
  'create_table',
  'download_file',
  'send_email'
]

/**
 * 构造确认提示文案（与 develop 行为一致，仅文案，可被 messageBuilder 覆盖）
 */
export function buildDefaultConfirmMessage (toolName, args = {}) {
  let message = ''
  let detail = ''
  switch (toolName) {
    case 'set_file_content':
      message = '即将写入文件'
      detail = `路径: ${args.path}\n内容大小: ${Buffer.byteLength(args.content || '', 'utf-8')} 字节`
      break
    case 'replace_file_string':
      message = '即将替换文件内容'
      detail = `路径: ${args.path}\n替换: "${args.old_string}" → "${args.new_string}"`
      break
    case 'copy_file':
      message = '即将复制文件'
      detail = `从: ${args.source_path}\n到: ${args.destination_path}`
      break
    case 'move_file':
      message = '即将移动文件'
      detail = `从: ${args.source_path}\n到: ${args.destination_path}`
      break
    case 'execute_command':
      message = '即将执行系统命令'
      detail = `命令: ${args.command}\n参数: ${(args.args || []).join(' ')}\n工作目录: ${args.cwd || process.cwd()}`
      break
    case 'launch_application':
      message = '即将启动应用程序'
      detail = `程序路径: ${args.executable}\n启动参数: ${(args.args || []).join(' ') || '无'}`
      break
    case 'insert_record':
      message = '即将向数据库插入记录'
      detail = `表名: ${args.table_name}\n数据库: ${args.database || 'main'}\n记录数: ${args.batch_data ? args.batch_data.length : 1}`
      break
    case 'update_record':
      message = '即将更新数据库记录'
      detail = `表名: ${args.table_name}\n数据库: ${args.database || 'main'}\n更新条件: ${args.where ? JSON.stringify(args.where) : args.where_clause}`
      break
    case 'delete_record':
      message = '即将删除数据库记录（不可恢复）'
      detail = `表名: ${args.table_name}\n数据库: ${args.database || 'main'}\n删除条件: ${args.where ? JSON.stringify(args.where) : args.where_clause}`
      break
    case 'create_table':
      message = '即将创建数据库表'
      detail = `表名: ${args.table_name}\n数据库: ${args.database || 'main'}\n字段数: ${args.columns ? args.columns.length : 0}`
      break
    case 'download_file':
      message = '即将从网络下载文件'
      detail = `URL: ${args.url}\n保存目录: ${args.save_path}${args.filename ? `\n文件名: ${args.filename}` : ''}`
      break
    default:
      message = `即将执行操作: ${toolName}`
      detail = JSON.stringify(args, null, 2)
  }
  return { message, detail }
}

/**
 * @param {Object} options
 * @param {boolean} [options.isCLI=false]                     CLI 模式（自动确认）
 * @param {boolean} [options.autoConfirm=false]               强制自动确认（高于 CLI）
 * @param {string[]} [options.sensitiveTools]                 敏感工具列表（默认 DEFAULT_SENSITIVE_TOOLS）
 * @param {(payload:{toolName,message,detail,args})=>Promise<boolean>} [options.showConfirmDialog]
 *                                                            注入：显示原生/前端弹窗，返回是否确认
 * @param {()=>Promise<{enabled:boolean,seconds:number,applyToTools:string[]}|null>} [options.countdownConfigReader]
 *                                                            注入：读取倒计时配置（来自 config-core）
 * @param {(payload:{confirmId,toolName,message,detail,countdown})=>Promise<void>} [options.sendFrontendConfirm]
 *                                                            注入：发送倒计时确认请求到前端（IPC）
 * @param {(toolName, args)=>{message:string,detail:string}} [options.messageBuilder]
 *                                                            自定义消息构造，默认 buildDefaultConfirmMessage
 * @param {number}  [options.cacheTTL=5000]                   倒计时配置缓存 TTL（毫秒）
 */
export function createConfirmationManager (options = {}) {
  const {
    isCLI = false,
    autoConfirm = false,
    sensitiveTools = DEFAULT_SENSITIVE_TOOLS,
    showConfirmDialog = null,
    countdownConfigReader = null,
    sendFrontendConfirm = null,
    messageBuilder = buildDefaultConfirmMessage,
    cacheTTL = 5000
  } = options

  const sensitiveSet = new Set(sensitiveTools)
  /** @type {Map<string, { resolve: Function, timeout: any }>} */
  const pendingConfirmations = new Map()

  let countdownConfigCache = null
  let countdownConfigCacheTime = 0

  function clearCountdownConfigCache () {
    countdownConfigCache = null
    countdownConfigCacheTime = 0
    logger.debug('倒计时配置缓存已清除')
  }

  function requiresConfirmation (toolName) {
    return sensitiveSet.has(toolName)
  }

  async function getCountdownConfig () {
    if (!countdownConfigReader) return null
    const now = Date.now()
    if (countdownConfigCache && (now - countdownConfigCacheTime) < cacheTTL) {
      return countdownConfigCache
    }
    try {
      const cfg = await countdownConfigReader()
      if (cfg && typeof cfg === 'object') {
        countdownConfigCache = cfg
        countdownConfigCacheTime = now
        return cfg
      }
    } catch (error) {
      logger.error('读取倒计时配置失败:', error)
    }
    return null
  }

  async function isCountdownEnabledForTool (toolName) {
    const cfg = await getCountdownConfig()
    return !!(cfg && cfg.enabled && Array.isArray(cfg.applyToTools) && cfg.applyToTools.includes(toolName))
  }

  async function requestFrontendCountdownConfirm (toolName, args, countdownSeconds) {
    if (!sendFrontendConfirm) {
      logger.warn('未注入 sendFrontendConfirm，倒计时模式回退为自动确认')
      return true
    }
    const confirmId = `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
    const { message, detail } = messageBuilder(toolName, args)
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        pendingConfirmations.delete(confirmId)
        logger.debug(`倒计时结束，自动确认: ${toolName}`)
        resolve(true)
      }, countdownSeconds * 1000)
      pendingConfirmations.set(confirmId, { resolve, timeout: timeoutId })
      Promise.resolve()
        .then(() => sendFrontendConfirm({ confirmId, toolName, message, detail, countdown: countdownSeconds }))
        .catch((err) => {
          logger.error('发送前端确认请求失败:', err)
          clearTimeout(timeoutId)
          pendingConfirmations.delete(confirmId)
          resolve(false)
        })
    })
  }

  /**
   * 由 IPC handler 调用：处理前端返回的确认结果
   */
  function resolvePendingConfirm (confirmId, confirmed) {
    const pending = pendingConfirmations.get(confirmId)
    if (!pending) {
      logger.warn(`收到未知的确认响应: ${confirmId}`)
      return false
    }
    clearTimeout(pending.timeout)
    pendingConfirmations.delete(confirmId)
    pending.resolve(!!confirmed)
    logger.debug(`已处理前端确认响应: ${confirmId}, confirmed=${confirmed}`)
    return true
  }

  /**
   * 主入口：请求工具执行确认
   */
  async function confirmToolExecution (toolName, args = {}) {
    if (autoConfirm) {
      logger.debug(`autoConfirm=true，自动确认: ${toolName}`)
      return true
    }
    if (isCLI) {
      logger.debug(`CLI 模式，自动确认: ${toolName}`)
      return true
    }
    if (!sensitiveSet.has(toolName)) return true

    if (await isCountdownEnabledForTool(toolName)) {
      const cfg = await getCountdownConfig()
      const seconds = Math.max(1, Number(cfg?.seconds || 5))
      logger.info(`倒计时确认模式: ${toolName}, 倒计时=${seconds}秒`)
      return requestFrontendCountdownConfirm(toolName, args, seconds)
    }

    if (!showConfirmDialog) {
      logger.warn(`未注入 showConfirmDialog，默认拒绝: ${toolName}`)
      return false
    }

    const { message, detail } = messageBuilder(toolName, args)
    try {
      const ok = await showConfirmDialog({ toolName, message, detail, args })
      return !!ok
    } catch (error) {
      logger.error(`showConfirmDialog 失败 (${toolName}):`, error)
      return false
    }
  }

  return {
    requiresConfirmation,
    confirmToolExecution,
    resolvePendingConfirm,
    clearCountdownConfigCache,
    get sensitiveTools () { return Array.from(sensitiveSet) }
  }
}
