/**
 * qoder_task 项目注册表存取模块（单一来源）
 *
 * 配置文件 ~/.xingseq/qoder-projects.json：
 *   { "defaultProject": "xingseq",
 *     "projects": [{ "name": "xingseq", "path": "/abs/path", "description": "…" }] }
 *
 * 使用方：
 *   - src/cli.mjs        projects 子命令（list/add/remove/default）
 *   - src/gateway.mjs    管理界面 HTTP API（/api/projects*）
 *   - chat-core tools/qoder.js 独立读取同一文件（loadQoderProjects）
 */

import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

export function projectsConfigPath() {
  return path.join(os.homedir(), '.xingseq', 'qoder-projects.json')
}

export function loadProjectsConfig() {
  try {
    return JSON.parse(fs.readFileSync(projectsConfigPath(), 'utf8'))
  } catch {
    return {}
  }
}

export function saveProjectsConfig(cfg) {
  const file = projectsConfigPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
}

/** 项目名供邮件 AI 路由引用，限定安全字符集 */
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

/** 列出全部项目（附目录存在标记，供 UI 提示「已被忽略」） */
export function listProjects() {
  const cfg = loadProjectsConfig()
  const projects = Array.isArray(cfg.projects) ? cfg.projects : []
  return {
    configPath: projectsConfigPath(),
    defaultProject: cfg.defaultProject || null,
    projects: projects.map(p => ({ ...p, exists: fs.existsSync(p.path) }))
  }
}

/**
 * 登记项目（同名覆盖）。目录不存在时仍登记（返回 exists:false，目录出现后自动生效）。
 * 返回新登记条目；name 不合法时抛错。
 */
export function addProject(name, projectPath, description = '') {
  if (!NAME_RE.test(name || '')) {
    throw new Error('项目名只能包含字母、数字、-、_（且以字母或数字开头）')
  }
  const abs = path.resolve(String(projectPath || ''))
  const cfg = loadProjectsConfig()
  cfg.projects = Array.isArray(cfg.projects) ? cfg.projects : []
  cfg.projects = cfg.projects.filter(p => p.name !== name)
  cfg.projects.push({ name, path: abs, ...(description ? { description } : {}) })
  if (!cfg.defaultProject) cfg.defaultProject = name
  saveProjectsConfig(cfg)
  return { name, path: abs, description, exists: fs.existsSync(abs) }
}

/** 移除项目；若移除的是默认项目则顺延到首个剩余项目。返回是否真的移除了。 */
export function removeProject(name) {
  const cfg = loadProjectsConfig()
  cfg.projects = Array.isArray(cfg.projects) ? cfg.projects : []
  const before = cfg.projects.length
  cfg.projects = cfg.projects.filter(p => p.name !== name)
  if (cfg.defaultProject === name) cfg.defaultProject = cfg.projects[0]?.name || null
  saveProjectsConfig(cfg)
  return before !== cfg.projects.length
}

/** 设默认项目（邮件里不指定项目名时 qoder_task 使用）。项目不存在时抛错。 */
export function setDefaultProject(name) {
  const cfg = loadProjectsConfig()
  cfg.projects = Array.isArray(cfg.projects) ? cfg.projects : []
  if (!cfg.projects.some(p => p.name === name)) {
    throw new Error(`未找到项目: ${name}`)
  }
  cfg.defaultProject = name
  saveProjectsConfig(cfg)
}
