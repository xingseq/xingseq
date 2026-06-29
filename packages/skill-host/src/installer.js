/**
 * skill-host/installer.js
 * 子应用安装/卸载/更新引擎
 *
 * 安装流程：
 *   1. shallow clone 对应 repo 到 projectsDir/<name>/
 *   2. 读取 manifest 的 dependencies.runtime 执行 npm install
 *   3. 如果 ui.requireBuild 则执行 buildCommand
 *
 * 进度通过 onProgress 回调暴露，供前端 SSE 推送
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { getLogger } from '@xingseq/shared-utils/logger'

const logger = getLogger('SkillInstaller')

// ── 默认配置 ──────────────────────────────────────────────────────────────────
const DEFAULT_CLONE_TIMEOUT = 120_000   // git clone 超时
const DEFAULT_NPM_TIMEOUT = 180_000     // npm install 超时
const DEFAULT_BUILD_TIMEOUT = 120_000   // build 超时

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/**
 * 执行子进程命令，返回 { success, stdout, stderr, code }
 */
function runCommand(cmd, args, { cwd, timeout = 60_000, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      timeout,
      env: env || { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    child.on('error', (err) => {
      resolve({ success: false, stdout, stderr, code: -1, error: err.message })
    })

    child.on('close', (code) => {
      resolve({ success: code === 0, stdout, stderr, code })
    })
  })
}

/**
 * 安全删除目录（递归）
 */
async function removeDir(dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true })
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

// ── 安装 ──────────────────────────────────────────────────────────────────────

/**
 * 安装子应用
 *
 * @param {object} opts
 * @param {import('./registry.js').RegistryEntry} opts.entry  注册中心条目
 * @param {string} opts.projectsDir  本地项目目录
 * @param {function} [opts.onProgress]  进度回调 (step, message, detail?)
 * @param {object} [opts.timeouts]
 * @returns {Promise<{ success: boolean, name: string, error?: string }>}
 */
export async function install({
  entry,
  projectsDir,
  onProgress = () => {},
  timeouts = {}
} = {}) {
  const { name, repo, branch = 'main' } = entry
  const targetDir = path.join(projectsDir, name)

  logger.info(`开始安装: ${name} from ${repo}`)

  // 0. 检查是否已安装
  try {
    await fs.access(path.join(targetDir, 'sub-app-manifest.json'))
    return { success: false, name, error: `${name} 已安装，如需更新请使用 update` }
  } catch {
    // 不存在，继续
  }

  // 1. Git shallow clone
  onProgress('clone', `正在克隆 ${name}...`, { repo, branch })
  logger.debug(`git clone --depth 1 --branch ${branch} ${repo} ${targetDir}`)

  const cloneResult = await runCommand('git', [
    'clone', '--depth', '1', '--branch', branch, repo, targetDir
  ], { timeout: timeouts.clone || DEFAULT_CLONE_TIMEOUT })

  if (!cloneResult.success) {
    await removeDir(targetDir)
    const error = `Git clone 失败: ${cloneResult.stderr || cloneResult.error}`
    logger.error(error)
    return { success: false, name, error }
  }
  onProgress('clone', `${name} 克隆完成`)

  // 2. 读取 manifest
  let manifest
  try {
    const manifestRaw = await fs.readFile(
      path.join(targetDir, 'sub-app-manifest.json'), 'utf-8'
    )
    manifest = JSON.parse(manifestRaw)
  } catch (err) {
    await removeDir(targetDir)
    const error = `读取 manifest 失败: ${err.message}`
    logger.error(error)
    return { success: false, name, error }
  }

  // 3. 安装运行时依赖（如果有 package.json）
  const hasPackageJson = await fs.access(path.join(targetDir, 'package.json'))
    .then(() => true).catch(() => false)

  if (hasPackageJson) {
    onProgress('install', `正在安装 ${name} 的依赖...`)
    logger.debug(`npm install --omit=dev (cwd: ${targetDir})`)

    const npmResult = await runCommand('npm', [
      'install', '--omit=dev', '--ignore-scripts'
    ], { cwd: targetDir, timeout: timeouts.npm || DEFAULT_NPM_TIMEOUT })

    if (!npmResult.success) {
      // 依赖安装失败不回滚，可能部分功能仍可用
      logger.warn(`npm install 部分失败: ${npmResult.stderr}`)
      onProgress('install', `${name} 依赖安装有警告`, { warning: npmResult.stderr })
    } else {
      onProgress('install', `${name} 依赖安装完成`)
    }
  }

  // 4. 构建 UI（如果需要）
  if (manifest.ui?.requireBuild && manifest.ui?.buildCommand) {
    onProgress('build', `正在构建 ${name} 的 UI...`)
    const buildCmd = manifest.ui.buildCommand
    const [buildBin, ...buildArgs] = buildCmd.split(/\s+/)

    logger.debug(`构建命令: ${buildCmd} (cwd: ${targetDir})`)

    const buildResult = await runCommand(buildBin, buildArgs, {
      cwd: targetDir,
      timeout: timeouts.build || DEFAULT_BUILD_TIMEOUT
    })

    if (!buildResult.success) {
      logger.warn(`构建失败: ${buildResult.stderr}`)
      onProgress('build', `${name} UI 构建失败（CLI 功能仍可用）`, { warning: buildResult.stderr })
    } else {
      onProgress('build', `${name} UI 构建完成`)
    }
  }

  // 5. 完成
  onProgress('done', `${name} 安装完成`)
  logger.info(`安装完成: ${name}`)
  return { success: true, name, manifest }
}

// ── 卸载 ──────────────────────────────────────────────────────────────────────

/**
 * 卸载子应用
 *
 * @param {object} opts
 * @param {string} opts.name        子应用名
 * @param {string} opts.projectsDir 本地项目目录
 * @param {function} [opts.onProgress]
 * @returns {Promise<{ success: boolean, name: string, error?: string }>}
 */
export async function uninstall({ name, projectsDir, onProgress = () => {} } = {}) {
  const targetDir = path.join(projectsDir, name)

  logger.info(`开始卸载: ${name}`)

  // 检查是否存在
  try {
    await fs.access(targetDir)
  } catch {
    return { success: false, name, error: `${name} 未安装` }
  }

  onProgress('uninstall', `正在删除 ${name}...`)
  await removeDir(targetDir)
  onProgress('done', `${name} 已卸载`)

  logger.info(`卸载完成: ${name}`)
  return { success: true, name }
}

// ── 更新 ──────────────────────────────────────────────────────────────────────

/**
 * 更新子应用（先卸载再安装）
 *
 * @param {object} opts
 * @param {import('./registry.js').RegistryEntry} opts.entry  注册中心条目
 * @param {string} opts.projectsDir
 * @param {function} [opts.onProgress]
 * @param {object} [opts.timeouts]
 * @returns {Promise<{ success: boolean, name: string, error?: string }>}
 */
export async function update({ entry, projectsDir, onProgress = () => {}, timeouts = {} } = {}) {
  const { name } = entry

  logger.info(`开始更新: ${name}`)
  onProgress('update', `正在更新 ${name}...`)

  // 卸载旧版
  const uninstallResult = await uninstall({ name, projectsDir, onProgress })
  if (!uninstallResult.success && !uninstallResult.error.includes('未安装')) {
    return uninstallResult
  }

  // 重新安装
  return install({ entry, projectsDir, onProgress, timeouts })
}
