/**
 * 工具注册中心
 *
 * 替代原 electron/tools/executors/index.js 的超大 switch 派发：
 *   - register(group, { tools, execute }) 把工具组与执行器一起注册进来
 *   - getOverview() / getTools(groupName) / getAllTools() / getToolByName(name)
 *   - dispatch(toolCall, ctx) 找到对应执行器并调用
 *
 * registry 不感知具体工具实现，所有 executor 由上层注入。
 */

import { getLogger } from '@xingseq/shared-utils/logger'

const logger = getLogger('ToolRegistry')

/**
 * @typedef {Object} ToolGroupRegistration
 * @property {Array}    tools                  工具定义数组（OpenAI Function Calling 格式）
 * @property {string}   [displayName]          显示名称
 * @property {Function} [execute]              (toolName, args, ctx) => Promise<any>，组级派发器
 * @property {Object<string, Function>} [handlers]  { [toolName]: (args, ctx) => Promise<any> }
 */

export function createToolRegistry () {
  /** @type {Map<string, ToolGroupRegistration>} */
  const groups = new Map()
  /** @type {Map<string, { groupName: string, def: Object }>} */
  const toolIndex = new Map()

  function register (groupName, registration) {
    if (!groupName || typeof groupName !== 'string') {
      throw new TypeError('register(groupName, registration): groupName 必须为非空字符串')
    }
    if (!registration || typeof registration !== 'object') {
      throw new TypeError('register: registration 必须为对象')
    }
    const tools = Array.isArray(registration.tools) ? registration.tools : []
    const execute = typeof registration.execute === 'function' ? registration.execute : null
    const handlers = registration.handlers && typeof registration.handlers === 'object' ? registration.handlers : null
    if (!execute && !handlers) {
      throw new TypeError(`register(${groupName}): 必须提供 execute(toolName,args,ctx) 或 handlers 映射`)
    }
    groups.set(groupName, {
      tools,
      displayName: registration.displayName || groupName,
      execute,
      handlers
    })
    for (const def of tools) {
      const name = def?.function?.name
      if (!name) continue
      toolIndex.set(name, { groupName, def })
    }
    logger.debug(`已注册工具组: ${groupName}, tools=${tools.length}`)
  }

  function unregister (groupName) {
    const entry = groups.get(groupName)
    if (!entry) return false
    for (const def of entry.tools) {
      const name = def?.function?.name
      if (name && toolIndex.get(name)?.groupName === groupName) toolIndex.delete(name)
    }
    groups.delete(groupName)
    logger.debug(`已注销工具组: ${groupName}`)
    return true
  }

  function listGroups () {
    return Array.from(groups.keys())
  }

  function getGroup (groupName) {
    return groups.get(groupName) || null
  }

  function getTools (groupName) {
    const entry = groups.get(groupName)
    return entry ? [...entry.tools] : []
  }

  function getAllTools () {
    const all = []
    for (const entry of groups.values()) all.push(...entry.tools)
    return all
  }

  function getToolByName (name) {
    return toolIndex.get(name)?.def || null
  }

  function getGroupOfTool (name) {
    return toolIndex.get(name)?.groupName || null
  }

  function getOverview () {
    return Array.from(groups.entries()).map(([name, entry]) => ({
      name,
      displayName: entry.displayName,
      toolCount: entry.tools.length
    }))
  }

  /**
   * 派发执行
   * @param {{ name: string, args?: object, arguments?: string|object }} toolCall
   * @param {object} [ctx] 透传给执行器的上下文
   */
  async function dispatch (toolCall, ctx = {}) {
    if (!toolCall || typeof toolCall !== 'object') {
      throw new TypeError('dispatch(toolCall): toolCall 必须是对象')
    }
    const name = toolCall.name || toolCall.function?.name
    if (!name) throw new Error('dispatch: toolCall.name 缺失')

    // 兼容三种入参形态：
    //   1. { name, args: {...} }                直接对象
    //   2. { name, arguments: '...' }           OpenAI 顶层（少见）
    //   3. { function: { name, arguments: '...' } }  OpenAI 标准 tool_call
    let args = toolCall.args ?? toolCall.arguments ?? toolCall.function?.arguments
    if (typeof args === 'string') {
      try { args = args.length ? JSON.parse(args) : {} } catch (e) {
        throw new Error(`dispatch(${name}): JSON.parse(arguments) 失败: ${e.message}`)
      }
    }
    args = args || {}

    const indexed = toolIndex.get(name)
    if (!indexed) {
      throw new Error(`dispatch: 未注册的工具 "${name}"`)
    }
    const entry = groups.get(indexed.groupName)
    if (entry.handlers && typeof entry.handlers[name] === 'function') {
      return entry.handlers[name](args, ctx)
    }
    if (entry.execute) {
      return entry.execute(name, args, ctx)
    }
    throw new Error(`dispatch(${name}): 工具组 ${indexed.groupName} 无可用执行器`)
  }

  return {
    register,
    unregister,
    dispatch,
    listGroups,
    getGroup,
    getTools,
    getAllTools,
    getToolByName,
    getGroupOfTool,
    getOverview
  }
}
