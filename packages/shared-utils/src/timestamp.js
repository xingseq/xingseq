/**
 * 本地时间戳工具
 * 统一日志、审计、导出文件名等场景的时间格式。
 */

/**
 * 格式化本地时间戳 YYYY-MM-DD HH:mm:ss
 * @returns {string}
 */
export function formatLocalTimestamp() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const i = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${i}:${s}`
}

/**
 * 获取本地日期 YYYY-MM-DD
 * @returns {string}
 */
export function formatLocalDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 获取用于文件名的本地时间戳 YYYY-MM-DD_HH-mm-ss
 * @returns {string}
 */
export function formatLocalTimestampForFilename() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const i = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${d}_${h}-${i}-${s}`
}
