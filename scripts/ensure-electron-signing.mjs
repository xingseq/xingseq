#!/usr/bin/env node
/**
 * 确保 Electron 二进制已正确签名（macOS 必需）
 *
 * 背景：
 *   macOS 26.x 的 AMFI + syspolicyd 策略会 SIGKILL 未正确签名的二进制，
 *   即使 linker-signed 的 adhoc 签名也会被拒绝（"has no CMS blob"）。
 *   此脚本检查签名并自动修复。
 *
 * 用法：node scripts/ensure-electron-signing.mjs
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const electronPkgDir = path.join(rootDir, 'node_modules', 'electron')
const distDir = path.join(electronPkgDir, 'dist')
const appPath = path.join(distDir, 'Electron.app')
const pathTxt = path.join(electronPkgDir, 'path.txt')

function log(msg) { console.log(`[electron-sign] ${msg}`) }
function warn(msg) { console.warn(`[electron-sign] ⚠ ${msg}`) }

function hasElectronDep() {
  try {
    const p = path.join(rootDir, 'apps', 'electron-shell', 'package.json')
    if (!existsSync(p)) return false
    const { dependencies = {}, devDependencies = {} } = JSON.parse(readFileSync(p, 'utf-8'))
    return 'electron' in { ...dependencies, ...devDependencies }
  } catch { return false }
}

/** 检查签名是否包含 CMS blob */
function hasValidSignature(bundlePath) {
  try {
    // codesign -dvvv 输出到 stderr，需要合并
    const output = execSync(`codesign -dvvv "${bundlePath}" 2>&1`, { encoding: 'utf-8', timeout: 5000 })
    return output.includes('CMSDigest=')
  } catch { return false }
}

/** 在缓存中查找匹配 Electron 版本的 zip */
function findCachedZip(electronVersion) {
  const cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'electron')
  if (!existsSync(cacheDir)) return null

  const arch = process.arch
  const zipName = `electron-v${electronVersion}-darwin-${arch}.zip`

  for (const entry of readdirSync(cacheDir)) {
    try {
      const zipPath = path.join(cacheDir, entry, zipName)
      if (existsSync(zipPath)) return zipPath
    } catch {}
  }
  return null
}

// ── 主流程 ──────────────────────────────────────────────────
;(async () => {
  if (process.platform !== 'darwin') {
    log('非 macOS 平台，跳过')
    process.exit(0)
  }

  if (!hasElectronDep()) {
    log('未依赖 electron，跳过')
    process.exit(0)
  }

  // 读取 electron 版本信息
  let electronVersion = '0.0.0'
  try {
    electronVersion = JSON.parse(readFileSync(path.join(electronPkgDir, 'package.json'), 'utf-8')).version
  } catch {
    warn('无法读取 electron package.json')
    process.exit(0)
  }

  // 如果 Electron.app 不存在，尝试从缓存安装
  if (!existsSync(appPath)) {
    warn('Electron.app 不存在，尝试从缓存安装...')
    const cachedZip = findCachedZip(electronVersion)
    if (cachedZip) {
      log(`从缓存解压: ${cachedZip}`)
      execSync(`unzip -o "${cachedZip}" -d "${distDir}"`, { stdio: 'pipe', timeout: 60000 })
    } else {
      log('运行 electron install.js 下载...')
      try {
        execSync('node install.js', { cwd: electronPkgDir, stdio: 'inherit', timeout: 120000 })
      } catch (err) {
        warn(`install.js 失败: ${err.message}`)
        process.exit(0)
      }
    }
  }

  if (!existsSync(appPath)) {
    warn('Electron.app 仍不存在，请检查网络并手动运行 node node_modules/electron/install.js')
    process.exit(0)
  }

  // 签名检查与修复
  if (hasValidSignature(appPath)) {
    log('Electron 签名有效 ✓')
  } else {
    log('签名无效，正在 adhoc 签名...')
    try {
      execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'pipe', timeout: 30000 })
      log('签名完成 ✓')
    } catch (err) {
      warn(`签名失败: ${err.message}`)
      process.exit(0)
    }
  }

  // 确保 path.txt 存在
  if (!existsSync(pathTxt)) {
    writeFileSync(pathTxt, 'Electron.app/Contents/MacOS/Electron')
    log('已创建 path.txt')
  }

  log('完成')
})()
