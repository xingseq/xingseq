/**
 * 日志格式化工具
 * - 安全截断超长输出
 * - 识别"字符串被错误 spread 成对象"的情况，还原为字符串并标记
 * - 统一 util.inspect 深度、字符串/数组上限，兼容循环引用
 */
import { inspect } from 'util'

function looksLikeStringifiedString(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const keys = Object.keys(obj)
  const numKeys = keys.filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b)
  if (numKeys.length < 8) return false
  for (let i = 0; i < numKeys.length; i++) {
    if (numKeys[i] !== i) return false
  }
  for (const k of numKeys) {
    const v = obj[k]
    if (typeof v !== 'string' || v.length !== 1) return false
  }
  return true
}

function normalize(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (Array.isArray(value)) return value.map(v => normalize(v, seen))

  if (looksLikeStringifiedString(value)) {
    const keys = Object.keys(value)
    const numKeys = keys.filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b)
    const str = numKeys.map(i => value[i]).join('')
    const extra = {}
    for (const k of keys) {
      if (!/^\d+$/.test(k)) extra[k] = normalize(value[k], seen)
    }
    const tag = `«stringified:${str.length}» ${str}`
    return Object.keys(extra).length ? { __str__: tag, ...extra } : tag
  }

  const out = {}
  for (const k of Object.keys(value)) {
    out[k] = normalize(value[k], seen)
  }
  return out
}

function truncate(str, maxLen) {
  if (typeof str !== 'string') return String(str)
  if (str.length <= maxLen) return str
  return `${str.slice(0, maxLen)}…(+${str.length - maxLen} chars)`
}

/**
 * 格式化任意值为适合日志输出的单行字符串
 * @param {*} value
 * @param {object} [opts]
 * @param {number} [opts.maxLen=500]
 * @param {number} [opts.depth=3]
 * @param {number} [opts.maxString=120]
 * @param {number} [opts.maxArray=20]
 */
export function formatForLog(value, opts = {}) {
  const { maxLen = 500, depth = 3, maxString = 120, maxArray = 20 } = opts
  try {
    const normalized = normalize(value)
    const str = inspect(normalized, {
      depth,
      breakLength: Infinity,
      compact: true,
      maxStringLength: maxString,
      maxArrayLength: maxArray,
      colors: false
    })
    return truncate(str, maxLen)
  } catch (err) {
    try { return truncate(String(value), maxLen) } catch { return '[Unserializable]' }
  }
}

export default formatForLog
