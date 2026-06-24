/**
 * VirtualMailboxStore - 多账户虚拟邮箱存储层
 *
 * 迁移自 develop/packages/agent-manager/lib/VirtualMailboxStore.js
 *
 * 用文件系统模拟"邮件服务器"，让 mail-gateway 可以在不依赖真实 SMTP/IMAP
 * 的前提下完整跑通邮件链路，便于测试。
 *
 * 存储布局：
 *   <rootDir>/<safeAddr>/
 *     ├── inbox.json   收件箱（追加写）
 *     └── sent.json    发件箱（追加写）
 *
 * 邮件信封结构：
 *   {
 *     uid, messageId, from, to, subject,
 *     content, date(ISOString), read(bool),
 *     metadata?: { tag?: string }
 *   }
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const DEFAULT_ROOT = path.join(os.homedir(), '.xingseq', 'mail-gateway', '.virtual-mailbox')

let _rootDir = null

/**
 * 初始化虚拟邮箱根目录（可选，不调则用默认路径）
 * @param {string} dir
 */
export function setRootDir(dir) {
  _rootDir = dir
}

function getRoot() {
  return _rootDir || DEFAULT_ROOT
}

/** 把邮箱地址转成安全目录名 */
export function safeAddr(addr) {
  return String(addr || '').trim().toLowerCase().replace(/[^a-z0-9]+/gi, '_')
}

function dirOf(addr) {
  return path.join(getRoot(), safeAddr(addr))
}

function inboxPath(addr) {
  return path.join(dirOf(addr), 'inbox.json')
}

function sentPath(addr) {
  return path.join(dirOf(addr), 'sent.json')
}

async function ensureDir(d) {
  await fs.mkdir(d, { recursive: true })
}

async function readJsonArray(file) {
  try {
    const txt = await fs.readFile(file, 'utf8')
    const data = JSON.parse(txt)
    return Array.isArray(data) ? data : []
  } catch (err) {
    if (err.code === 'ENOENT') return []
    try {
      await fs.rename(file, `${file}.broken-${Date.now()}`)
    } catch (_) { /* ignore */ }
    return []
  }
}

async function writeJsonArray(file, arr) {
  await ensureDir(path.dirname(file))
  await fs.writeFile(file, JSON.stringify(arr, null, 2), 'utf8')
}

let _uidSeq = Date.now()
function nextUid() {
  _uidSeq += 1
  return _uidSeq
}

function buildEnvelope({ from, to, subject, content, attachments, metadata }) {
  const uid = nextUid()
  return {
    uid,
    messageId: `<vmbx-${uid}@virtual.local>`,
    from: from || '',
    to: to || '',
    subject: subject || '',
    content: content || '',
    attachments: Array.isArray(attachments) ? attachments : [],
    date: new Date().toISOString(),
    read: false,
    metadata: metadata || {}
  }
}

/**
 * 投递一封邮件到收件人邮箱
 * @returns {Promise<{ delivered: string[], envelope: object }>}
 */
export async function deliver({ from, to, subject, content, attachments, metadata }) {
  if (!to) throw new Error('deliver: 缺少收件人 to')
  const envelope = buildEnvelope({ from, to, subject, content, attachments, metadata })

  const recipients = String(to).split(/[,;]/).map(s => {
    const m = s.match(/<([^>]+)>/)
    return (m ? m[1] : s).trim()
  }).filter(Boolean)

  const delivered = []
  for (const addr of recipients) {
    const file = inboxPath(addr)
    const list = await readJsonArray(file)
    list.push({ ...envelope, to: addr })
    await writeJsonArray(file, list)
    delivered.push(addr)
  }
  return { delivered, envelope }
}

/**
 * 记录一封"已发送"邮件到发件人的 sent 文件夹
 */
export async function recordSent(fromAddr, envelope) {
  if (!fromAddr) return
  const file = sentPath(fromAddr)
  const list = await readJsonArray(file)
  list.push(envelope)
  await writeJsonArray(file, list)
}

/**
 * 列出收件箱
 * @param {string} addr
 * @param {{ unreadOnly?: boolean, sinceUid?: number, limit?: number }} opts
 */
export async function listInbox(addr, opts = {}) {
  const list = await readJsonArray(inboxPath(addr))
  let out = list
  if (opts.unreadOnly) out = out.filter(m => !m.read)
  if (typeof opts.sinceUid === 'number') out = out.filter(m => m.uid > opts.sinceUid)
  if (typeof opts.limit === 'number') out = out.slice(-opts.limit)
  return out
}

/** 列出发件箱 */
export async function listSent(addr, opts = {}) {
  const list = await readJsonArray(sentPath(addr))
  if (typeof opts.limit === 'number') return list.slice(-opts.limit)
  return list
}

/** 把指定 uid 的邮件标记为已读 */
export async function markRead(addr, uid) {
  const file = inboxPath(addr)
  const list = await readJsonArray(file)
  let changed = false
  for (const m of list) {
    if (m.uid === uid && !m.read) { m.read = true; changed = true }
  }
  if (changed) await writeJsonArray(file, list)
  return changed
}

/** 删除指定 uid 的邮件 */
export async function deleteMail(addr, uid) {
  const file = inboxPath(addr)
  const list = await readJsonArray(file)
  const next = list.filter(m => m.uid !== uid)
  if (next.length !== list.length) {
    await writeJsonArray(file, next)
    return true
  }
  return false
}

/**
 * 重置邮箱：不传 addr 时清空所有虚拟邮箱
 */
export async function reset(addr) {
  if (addr) {
    try { await fs.rm(dirOf(addr), { recursive: true, force: true }) } catch (_) {}
    return [addr]
  }
  let removed = []
  try {
    const entries = await fs.readdir(getRoot(), { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory()) {
        await fs.rm(path.join(getRoot(), e.name), { recursive: true, force: true })
        removed.push(e.name)
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  return removed
}

/** 列出所有已存在的虚拟邮箱（safeDir 名） */
export async function listMailboxes() {
  try {
    const entries = await fs.readdir(getRoot(), { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => e.name)
  } catch (err) {
    if (err.code !== 'ENOENT') return []
    throw err
  }
}

export const __paths = { getRoot, inboxPath, sentPath }
