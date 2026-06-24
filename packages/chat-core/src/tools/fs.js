/**
 * chat-app 文件写工具组
 *
 * 工具命名与 develop 保持一致，便于 tool-registry 的 DEFAULT_SENSITIVE_TOOLS 自动命中：
 *   - set_file_content       写入/创建文件（覆盖）
 *   - replace_file_string    行内替换字符串（精确匹配）
 *   - create_directory       递归创建目录
 *   - delete_file            删除文件或空目录
 *
 * 强制约束：
 *   - 全部限制在 workspace.filesDir 内（resolveSafePath，越权抛错）
 *   - 单文件大小上限 10MB（与 develop 一致）
 *   - 删除递归默认禁用，需显式 recursive=true
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveSafePath, MAX_FILE_SIZE } from '../security.js'

// ── OpenAI Function Calling 工具定义 ─────────────────────────────────────────

export const setFileContentTool = {
  type: 'function',
  function: {
    name: 'set_file_content',
    description: '写入或创建文件（整文件覆盖）。路径相对于工作区根，禁止越权。父目录不存在会自动创建。单次写入上限 10MB。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径，相对于工作区根' },
        content: { type: 'string', description: '文件全部内容（UTF-8）' }
      },
      required: ['path', 'content']
    }
  }
}

export const replaceFileStringTool = {
  type: 'function',
  function: {
    name: 'replace_file_string',
    description: '在文件中把 old_string 精确替换为 new_string。要求 old_string 在文件中唯一出现，否则报错。适合小幅修改。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径，相对于工作区根' },
        old_string: { type: 'string', description: '需要被替换的旧字符串（必须在文件中唯一出现）' },
        new_string: { type: 'string', description: '替换后的新字符串' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  }
}

export const createDirectoryTool = {
  type: 'function',
  function: {
    name: 'create_directory',
    description: '递归创建目录（mkdir -p）。路径相对于工作区根，禁止越权。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径，相对于工作区根' }
      },
      required: ['path']
    }
  }
}

export const deleteFileTool = {
  type: 'function',
  function: {
    name: 'delete_file',
    description: '删除文件或空目录。如要递归删除目录需显式传入 recursive=true。路径相对于工作区根，禁止越权。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件或目录路径，相对于工作区根' },
        recursive: {
          type: 'boolean',
          description: '是否递归删除目录及其内容，默认 false',
          default: false
        }
      },
      required: ['path']
    }
  }
}

export const FS_TOOLS = [setFileContentTool, replaceFileStringTool, createDirectoryTool, deleteFileTool]

// ── Handlers ────────────────────────────────────────────────────────────────

export function createFsHandlers({ cwd } = {}) {
  if (!cwd) throw new Error('createFsHandlers: cwd（workspace.filesDir）必填')

  return {
    set_file_content: async (args = {}) => {
      if (!args.path) throw new Error('参数 path 必填')
      if (typeof args.content !== 'string') throw new Error('参数 content 必须是字符串')
      const size = Buffer.byteLength(args.content, 'utf-8')
      if (size > MAX_FILE_SIZE) {
        throw new Error(`内容过大（${size} 字节），上限 ${MAX_FILE_SIZE} 字节`)
      }
      const full = resolveSafePath(cwd, args.path)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, args.content, 'utf-8')
      return { path: args.path, size, message: '写入成功' }
    },

    replace_file_string: async (args = {}) => {
      if (!args.path) throw new Error('参数 path 必填')
      if (typeof args.old_string !== 'string' || args.old_string === '') {
        throw new Error('参数 old_string 必填且不能为空')
      }
      if (typeof args.new_string !== 'string') {
        throw new Error('参数 new_string 必填')
      }
      const full = resolveSafePath(cwd, args.path)
      const stat = await fs.stat(full)
      if (!stat.isFile()) throw new Error(`不是文件：${args.path}`)
      const text = await fs.readFile(full, 'utf-8')
      const idx = text.indexOf(args.old_string)
      if (idx === -1) {
        throw new Error(`old_string 在文件中未找到`)
      }
      const lastIdx = text.lastIndexOf(args.old_string)
      if (idx !== lastIdx) {
        throw new Error(`old_string 在文件中出现多次（${countOccurrence(text, args.old_string)} 次），需要更长的上下文以保证唯一`)
      }
      const next = text.slice(0, idx) + args.new_string + text.slice(idx + args.old_string.length)
      const newSize = Buffer.byteLength(next, 'utf-8')
      if (newSize > MAX_FILE_SIZE) {
        throw new Error(`替换后文件过大（${newSize} 字节），上限 ${MAX_FILE_SIZE} 字节`)
      }
      await fs.writeFile(full, next, 'utf-8')
      return { path: args.path, replaced: 1, size: newSize, message: '替换成功' }
    },

    create_directory: async (args = {}) => {
      if (!args.path) throw new Error('参数 path 必填')
      const full = resolveSafePath(cwd, args.path)
      await fs.mkdir(full, { recursive: true })
      return { path: args.path, message: '目录已创建' }
    },

    delete_file: async (args = {}) => {
      if (!args.path) throw new Error('参数 path 必填')
      const full = resolveSafePath(cwd, args.path)
      // 不允许把 workspace 根目录本身删了
      if (path.resolve(full) === path.resolve(cwd)) {
        throw new Error('不能删除工作区根目录')
      }
      const stat = await fs.stat(full).catch(() => null)
      if (!stat) throw new Error(`路径不存在：${args.path}`)
      if (stat.isDirectory()) {
        if (!args.recursive) {
          // 仅当目录为空时允许 rmdir
          const entries = await fs.readdir(full)
          if (entries.length > 0) {
            throw new Error(`目录非空，需显式传 recursive=true 才能递归删除`)
          }
          await fs.rmdir(full)
        } else {
          await fs.rm(full, { recursive: true, force: false })
        }
        return { path: args.path, type: 'directory', recursive: !!args.recursive, message: '删除成功' }
      }
      await fs.unlink(full)
      return { path: args.path, type: 'file', message: '删除成功' }
    }
  }
}

function countOccurrence(haystack, needle) {
  if (!needle) return 0
  let count = 0
  let pos = 0
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++
    pos += needle.length
  }
  return count
}
