/**
 * 原子文件写入工具（与 develop 版完全一致，无外部依赖）
 *
 * 策略：写入临时文件 → fs.rename（同卷下 POSIX 原子）
 * - 自动创建父目录（规避 ENOENT）
 * - 跨设备（EXDEV）兜底直接写
 * - 异常时清理残留 .tmp，避免目录污染
 * - 临时文件名含 pid + 随机后缀，规避并发 tmp 冲突
 */

import { promises as fs } from 'fs'
import fsSync from 'fs'
import path from 'path'
import crypto from 'crypto'

function makeTmpPath(filePath) {
  const rand = crypto.randomBytes(4).toString('hex')
  return `${filePath}.${process.pid}.${rand}.tmp`
}

export async function atomicWriteFile(filePath, content, encoding = 'utf-8') {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = makeTmpPath(filePath)
  try {
    await fs.writeFile(tmpPath, content, encoding)
    await fs.rename(tmpPath, filePath)
  } catch (err) {
    try { await fs.unlink(tmpPath) } catch (_) { /* noop */ }
    if (err && err.code === 'EXDEV') {
      await fs.writeFile(filePath, content, encoding)
      return
    }
    throw err
  }
}

export function atomicWriteFileSync(filePath, content, encoding = 'utf-8') {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmpPath = makeTmpPath(filePath)
  try {
    fsSync.writeFileSync(tmpPath, content, encoding)
    fsSync.renameSync(tmpPath, filePath)
  } catch (err) {
    try { fsSync.unlinkSync(tmpPath) } catch (_) { /* noop */ }
    if (err && err.code === 'EXDEV') {
      fsSync.writeFileSync(filePath, content, encoding)
      return
    }
    throw err
  }
}
