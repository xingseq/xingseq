/**
 * subAppTools handlers - 为 tool-registry 的 subApp 工具组提供执行逻辑
 *
 * 注入 SubAppHost 实例，将 list_sub_apps / execute_sub_app_command / get_sub_app_info
 * 三个工具映射到 host 的对应方法。
 */

/**
 * 创建子应用工具 handlers
 *
 * @param {import('./index.js').SubAppHost} host  createSubAppHost 返回的实例
 * @returns {Record<string, Function>}  tool-registry handlers 映射
 */
export function createSubAppHandlers(host) {
  if (!host || typeof host.list !== 'function') {
    throw new TypeError('createSubAppHandlers: 需要有效的 SubAppHost 实例')
  }

  return {
    /**
     * list_sub_apps — 列出所有已注册子应用
     */
    async list_sub_apps() {
      const apps = host.list()
      if (apps.length === 0) {
        return JSON.stringify({ success: true, apps: [], message: '当前没有已注册的子应用' })
      }
      return JSON.stringify({ success: true, apps, count: apps.length })
    },

    /**
     * execute_sub_app_command — 执行子应用 CLI 命令
     * @param {{ app_name: string, command: string, args?: object }} params
     */
    async execute_sub_app_command({ app_name, command, args } = {}) {
      if (!app_name) {
        return JSON.stringify({ success: false, error: '缺少 app_name 参数' })
      }
      if (!command) {
        return JSON.stringify({ success: false, error: '缺少 command 参数' })
      }
      if (!host.has(app_name)) {
        const available = host.list().map(a => a.name).join(', ')
        return JSON.stringify({
          success: false,
          error: `未找到子应用 "${app_name}"，可用: ${available || '无'}`
        })
      }

      const result = await host.execute(app_name, command, args || {})
      return JSON.stringify(result)
    },

    /**
     * get_sub_app_info — 获取子应用详细信息
     * @param {{ app_name: string }} params
     */
    async get_sub_app_info({ app_name } = {}) {
      if (!app_name) {
        return JSON.stringify({ success: false, error: '缺少 app_name 参数' })
      }
      const info = host.get(app_name)
      if (!info) {
        const available = host.list().map(a => a.name).join(', ')
        return JSON.stringify({
          success: false,
          error: `未找到子应用 "${app_name}"，可用: ${available || '无'}`
        })
      }
      // 脱敏：不暴露 rootPath 和敏感配置给 AI
      const { rootPath, ...safeInfo } = info
      return JSON.stringify({ success: true, app: safeInfo })
    }
  }
}
