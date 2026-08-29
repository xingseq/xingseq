/**
 * chat-app 核心对话会话
 *
 * 串联 L1/L2 + workspace：
 *   - llm-core executeChat（流式对话）
 *   - tool-registry（工具注册 + dispatch）
 *   - workspaceStore（workspace 级独立对话历史）
 *   - config-core（API Key）
 *
 * 设计要点：
 *   - "工作区"（workspace）是 chat-app 的一等概念
 *   - 工具组（list_dir / read_file）默认绑定 workspace.filesDir，且只读
 *   - 对话历史落到 workspace.memoryDir，切换 workspace = 切换记忆
 *
 * 暴露的 API：
 *   createWorkspaceRegistry({ workspace })
 *     → ToolRegistry，已注册名为 'workspace' 的工具组
 *
 *   createChatSession({ id?, title?, messages?, workspace?, registry?, tools? })
 *     → { id, title, messages, workspace, registry, tools, chat, save, load, clear, addTools }
 */

import { getDeepSeekApiKey } from '@xingseq/config-core'
import { createToolRegistry, subAppTools } from '@xingseq/tool-registry'
import { createSubAppHost, createSubAppHandlers } from '@xingseq/subapp-host'
import { runChatTurnWithTools } from './chatLoop.js'
import { DEMO_TOOLS, createDemoHandlers } from './tools/workspace.js'
import { WEB_TOOLS, createWebHandlers } from './tools/web.js'
import { FS_TOOLS, createFsHandlers } from './tools/fs.js'
import { SHELL_TOOLS, createShellHandlers } from './tools/shell.js'
import { EMAIL_TOOLS, createEmailHandlers } from './tools/email.js'
import { createQoderToolGroup } from './tools/qoder.js'
import { createWorkspaceStore } from './workspaceStore.js'
import { loadExternalTools } from './toolLoader.js'
import path from 'node:path'
import os from 'node:os'

/**
 * 创建一个挂载了 workspace 工具组的 registry
 *
 * @param {object} opts
 * @param {{ filesDir: string }} opts.workspace - 必填
 * @param {string} [opts.groupName='workspace']
 * @param {string} [opts.displayName='工作区工具']
 * @param {string[]} [opts.toolDirs] - 外部工具目录列表，默认 ['~/.xingseq/tools']
 * @param {boolean} [opts.enableSubApps=true] - 是否启用子应用工具组
 * @param {string} [opts.projectsDir] - 子应用项目目录，默认 '~/Library/Application Support/xingseq/projects'
 */
export async function createWorkspaceRegistry({
  workspace,
  groupName = 'workspace',
  displayName = '工作区工具',
  enableWeb = true,
  enableFs = true,
  enableShell = true,
  enableEmail = false,
  enableQoder = false,
  enableSubApps = true,
  emailSendFn = null,
  qoderBinPath = null,
  qoderAllowedRoot = null,
  toolDirs = [path.join(os.homedir(), '.xingseq', 'tools')],
  projectsDir = path.join(os.homedir(), 'Library', 'Application Support', 'xingseq', 'projects')
} = {}) {
  if (!workspace?.filesDir) {
    throw new Error('createWorkspaceRegistry: workspace.filesDir 必填')
  }
  const registry = createToolRegistry()
  registry.register(groupName, {
    displayName,
    tools: DEMO_TOOLS,
    handlers: createDemoHandlers({ cwd: workspace.filesDir })
  })
  if (enableWeb) {
    registry.register('web', {
      displayName: '联网工具',
      tools: WEB_TOOLS,
      handlers: createWebHandlers()
    })
  }
  if (enableFs) {
    registry.register('fs', {
      displayName: '文件写工具',
      tools: FS_TOOLS,
      handlers: createFsHandlers({ cwd: workspace.filesDir })
    })
  }
  if (enableShell) {
    registry.register('shell', {
      displayName: 'Shell 命令工具',
      tools: SHELL_TOOLS,
      handlers: createShellHandlers({ cwd: workspace.filesDir })
    })
  }
  if (enableEmail) {
    registry.register('email', {
      displayName: '邮件工具',
      tools: EMAIL_TOOLS,
      handlers: createEmailHandlers({ sendFn: emailSendFn || undefined })
    })
  }
  if (enableQoder) {
    // 项目注册表（~/.xingseq/qoder-projects.json）注入工具描述与多根白名单
    const qoderGroup = createQoderToolGroup({ binPath: qoderBinPath || undefined, allowedRoot: qoderAllowedRoot || undefined })
    registry.register('qoder', {
      displayName: 'Qoder 编程工具',
      tools: qoderGroup.tools,
      handlers: qoderGroup.handlers
    })
  }
  if (enableSubApps) {
    try {
      const subAppHost = await createSubAppHost({ projectsDir })
      if (subAppHost.size > 0) {
        registry.register('subApp', {
          displayName: '子应用工具',
          tools: subAppTools,
          handlers: createSubAppHandlers(subAppHost)
        })
      }
    } catch (err) {
      console.warn(`[chat-core] 子应用加载失败: ${err.message}`)
    }
  }

  // 自动发现外部工具插件
  if (toolDirs && toolDirs.length > 0) {
    const { loaded, skipped } = await loadExternalTools(registry, { toolDirs, workspace })
    if (loaded.length > 0) {
      console.log(`[chat-core] 已加载 ${loaded.length} 个外部工具插件: ${loaded.join(', ')}`)
    }
  }

  return registry
}

/**
 * 兼容别名（旧调用方）
 * @deprecated 改用 createWorkspaceRegistry
 */
export function createDemoRegistry({ cwd, workspace } = {}) {
  if (workspace) return createWorkspaceRegistry({ workspace })
  if (!cwd) throw new Error('createDemoRegistry: 需传 workspace 或 cwd')
  const registry = createToolRegistry()
  registry.register('demo', {
    displayName: '内置示例工具',
    tools: DEMO_TOOLS,
    handlers: createDemoHandlers({ cwd })
  })
  return registry
}

/**
 * 创建一次会话
 *
 * @param {object} opts
 * @param {string}   [opts.id]
 * @param {string}   [opts.title]
 * @param {Array}    [opts.messages]
 * @param {object}   [opts.workspace]   - { name, root, filesDir, memoryDir }，传入则启用 workspace 级记忆
 * @param {object}   [opts.registry]
 * @param {Array}    [opts.tools]
 */
export function createChatSession(opts = {}) {
  const id = opts.id || `chat-${Date.now()}`
  let title = opts.title || `对话 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
  const messages = Array.isArray(opts.messages) ? [...opts.messages] : []

  const workspace = opts.workspace || null
  const store = workspace ? createWorkspaceStore(workspace.memoryDir) : null

  // 工具注册中心：上层可传入；不传则不启用工具
  const registry = opts.registry || null
  // 工具列表：默认取 registry.getAllTools()
  let tools = opts.tools || (registry ? registry.getAllTools() : null)

  function addTools(extraTools = []) {
    if (!tools) tools = []
    tools.push(...extraTools)
  }

  async function resolveApiKey(override) {
    const key = override
      || process.env.DEEPSEEK_API_KEY
      || (await getDeepSeekApiKey().catch(() => null))
    return key || null
  }

  /**
   * 单次用户输入，可能触发多轮 tool_calls 循环
   */
  async function chat(userContent, options = {}) {
    if (typeof userContent !== 'string' || !userContent.trim()) {
      throw new Error('chat: userContent 不能为空')
    }
    messages.push({ role: 'user', content: userContent })

    const useTools = options.useTools !== false
    const apiKey = options.executor
      ? 'mock'                                     // 注入式 executor 不需要真实 key
      : await resolveApiKey(options.apiKey)
    if (!apiKey) {
      throw new Error('缺少 DEEPSEEK_API_KEY（环境变量或 config-core）')
    }

    const result = await runChatTurnWithTools({
      apiKey,
      messages,
      tools: useTools ? tools : null,
      registry: useTools ? registry : null,
      provider: options.provider || 'deepseek',
      mode: options.mode || 'chat',
      subModel: options.subModel,
      customParams: options.customParams,
      sessionId: id,
      onChunk: options.onChunk,
      onToolCall: options.onToolCall,
      onToolResult: options.onToolResult,
      onToolDenied: options.onToolDenied,
      confirmation: options.confirmation || null,
      executor: options.executor,
      trace: options.trace || undefined
    })

    return result
  }

  /**
   * 保存对话到 workspace（必须有 workspace 才能保存）
   */
  async function save() {
    if (!store) {
      return { success: false, error: '当前会话未绑定 workspace，无法保存' }
    }
    return store.saveConversation({ id, title, messages })
  }

  /**
   * 从 workspace 加载对话
   */
  async function load() {
    if (!store) {
      return { success: false, error: '当前会话未绑定 workspace，无法加载' }
    }
    const result = await store.loadConversation(id)
    if (result.success && result.data?.messages) {
      messages.length = 0
      messages.push(...result.data.messages)
      if (result.data.title) title = result.data.title
    }
    return result
  }

  function clear() {
    messages.length = 0
  }

  return {
    id,
    get title() { return title },
    set title(v) { title = v },
    messages,
    workspace,
    registry,
    get tools() { return tools },
    addTools,
    chat,
    save,
    load,
    clear
  }
}
