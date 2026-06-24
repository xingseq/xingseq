/**
 * chat-app 内置示例工具组
 *
 * 用于演示 tool-registry + llm-core 的完整 tool_calls 循环：
 *   - get_time: 返回当前时间
 *   - read_file: 在 cwd 内安全读文件（限制大小 + 路径校验）
 *   - list_dir:  列出目录下的文件
 *
 * 上层只需 registry.register('demo', { tools, handlers }) 即可挂载。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

// ── OpenAI Function Calling 工具定义 ─────────────────────────────────────────

export const getTimeTool = {
  type: 'function',
  function: {
    name: 'get_time',
    description: '获取当前系统时间，可指定时区或格式',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['iso', 'locale', 'unix'],
          description: '时间格式，默认 iso'
        }
      },
      required: []
    }
  }
}

export const readFileTool = {
  type: 'function',
  function: {
    name: 'read_file',
    description: '读取指定路径的文本文件内容（限制在工作目录内，最大 64KB）',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对于工作目录的文件路径' }
      },
      required: ['path']
    }
  }
}

export const listDirTool = {
  type: 'function',
  function: {
    name: 'list_dir',
    description: '列出指定目录下的文件和子目录（限制在工作目录内）',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对路径，默认为 .' }
      },
      required: []
    }
  }
}

export const DEMO_TOOLS = [getTimeTool, readFileTool, listDirTool]

// ── Handlers ────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 64 * 1024

function resolveSafe(cwd, relPath) {
  const full = path.resolve(cwd, relPath || '.')
  const rel = path.relative(cwd, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径越权：${relPath} 不在工作目录内`)
  }
  return full
}

export function createDemoHandlers({ cwd = process.cwd() } = {}) {
  return {
    get_time: async (args = {}) => {
      const now = new Date()
      switch (args.format) {
        case 'unix':   return { time: Math.floor(now.getTime() / 1000) }
        case 'locale': return { time: now.toLocaleString('zh-CN', { hour12: false }) }
        case 'iso':
        default:       return { time: now.toISOString() }
      }
    },

    read_file: async (args = {}) => {
      if (!args.path) throw new Error('参数 path 必填')
      const full = resolveSafe(cwd, args.path)
      const stat = await fs.stat(full)
      if (!stat.isFile()) throw new Error(`不是文件: ${args.path}`)
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(`文件过大（${stat.size} bytes），最大允许 ${MAX_FILE_BYTES} bytes`)
      }
      const content = await fs.readFile(full, 'utf-8')
      return { path: args.path, size: stat.size, content }
    },

    list_dir: async (args = {}) => {
      const full = resolveSafe(cwd, args.path || '.')
      const entries = await fs.readdir(full, { withFileTypes: true })
      return {
        path: args.path || '.',
        entries: entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : (e.isFile() ? 'file' : 'other')
        }))
      }
    }
  }
}
