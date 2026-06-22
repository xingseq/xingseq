/**
 * lazyLogger - 懒加载日志代理
 *
 * 当 logger.js 在系统未初始化时只会返回 fallback。若 import 时即 getLogger()，
 * 会把 logger 绑死在 fallback。本工厂返回同接口代理，首次实际调用时才解析。
 */
import { getLogger } from './logger.js'

/**
 * 创建懒加载 logger 代理
 * @param {string} scope
 * @returns {{info:Function,warn:Function,error:Function,debug:Function,verbose:Function}}
 */
export function createLazyLogger(scope) {
  let _logger = null
  const resolve = () => {
    if (!_logger) _logger = getLogger(scope)
    return _logger
  }
  return {
    info: (...args) => resolve().info(...args),
    warn: (...args) => resolve().warn(...args),
    error: (...args) => resolve().error(...args),
    debug: (...args) => resolve().debug(...args),
    verbose: (...args) => resolve().verbose?.(...args)
  }
}
