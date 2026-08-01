#!/usr/bin/env node
/**
 * 确保 Electron 二进制已正确签名（macOS 必需）
 *
 * 背景：
 *   macOS 26.x 的 AMFI + syspolicyd 策略会 SIGKILL 未正确签名的二进制，
 *   即使 linker-signed 的 adhoc 签名也会被拒绝（"has no CMS blob"）。
 *   同时 macOS Gatekeeper/XProtect 会将未签名/未公证的 .app 标记为恶意
 *   软件并移入废纸篓（com.apple.quarantine 扩展属性）。
 *
 *   此脚本执行以下修复链：
 *   1. 检测 Frameworks/ 目录完整性（不只是 Electron.app 存在）
 *   2. 从本地缓存解压（若缺失或不完整）
 *   3. 移除 com.apple.quarantine 隔离属性
 *   4. adhoc 重签名以添加 CMS blob
 *   5. 写入 dist/version 防止 install.js 重复下载
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

// 赋予开发版 Electron 一个唯一身份，否则默认的 com.github.Electron 会与系统
// 其它 Electron 应用（如微信开发者工具）在 TCC/LaunchServices 中混淆，导致
// 「完全磁盘访问」授权落到错误的 App 上且显示错误名称。
const DESIRED_BUNDLE_ID = 'dev.xingseq.console'
const DESIRED_APP_NAME = 'XingSeq'

function log(msg) { console.log(`[electron-sign] ${msg}`) }
function warn(msg) { console.warn(`[electron-sign] ⚠ ${msg}`) }
function fail(msg) {
  console.error(`[electron-sign] ✗ ${msg}`)
  process.exit(1)
}

function hasElectronDep() {
  try {
    const p = path.join(rootDir, 'apps', 'electron-shell', 'package.json')
    if (!existsSync(p)) return false
    const { dependencies = {}, devDependencies = {} } = JSON.parse(readFileSync(p, 'utf-8'))
    return 'electron' in { ...dependencies, ...devDependencies }
  } catch { return false }
}

/** 检查 Electron.app 是否完整（Frameworks/ 目录存在且有内容） */
function isBundleComplete(bundlePath) {
  if (!existsSync(bundlePath)) return false
  const fmwk = path.join(bundlePath, 'Contents', 'Frameworks')
  if (!existsSync(fmwk)) return false
  try {
    // 至少要有 Electron Framework.framework 才算完整
    const entries = readdirSync(fmwk)
    return entries.some(e => e.startsWith('Electron Framework'))
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

/** 移除 com.apple.quarantine 隔离属性（防止被 Gatekeeper 拦截） */
function removeQuarantine(bundlePath) {
  try {
    execSync(`xattr -d com.apple.quarantine "${bundlePath}" 2>/dev/null`, { timeout: 3000 })
    return true
  } catch { return false } // 属性不存在也算正常
}

/** 读取 bundle 的 CFBundleIdentifier */
function getBundleId(bundlePath) {
  try {
    const output = execSync(`codesign -dv "${bundlePath}" 2>&1`, { encoding: 'utf-8', timeout: 5000 })
    const m = output.match(/^Identifier=(.+)$/m)
    return m ? m[1].trim() : null
  } catch { return null }
}

/** 将 Electron.app 改造为 XingSeq 的唯一身份（改 Info.plist 会使旧签名失效，须随后重签）*/
function rebrand(bundlePath) {
  const pl = path.join(bundlePath, 'Contents', 'Info.plist')
  const pb = '/usr/libexec/PlistBuddy'
  const set = (key, value) => {
    try { execSync(`${pb} -c "Set :${key} ${value}" "${pl}"`, { stdio: 'pipe', timeout: 5000 }) }
    catch { execSync(`${pb} -c "Add :${key} string ${value}" "${pl}"`, { stdio: 'pipe', timeout: 5000 }) }
  }
  set('CFBundleIdentifier', DESIRED_BUNDLE_ID)
  set('CFBundleName', DESIRED_APP_NAME)
  set('CFBundleDisplayName', DESIRED_APP_NAME)
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

  // 如果 Electron.app 不存在或不完整（如缺少 Frameworks/），尝试修复
  if (!isBundleComplete(appPath)) {
    if (existsSync(appPath)) {
      warn('Electron.app 不完整（缺少 Frameworks/），将重新解压...')
    } else {
      warn('Electron.app 不存在，尝试从缓存安装...')
    }
    const cachedZip = findCachedZip(electronVersion)
    if (cachedZip) {
      log(`从缓存解压: ${cachedZip}`)
      execSync(`unzip -o -q "${cachedZip}" -d "${distDir}"`, { stdio: 'pipe', timeout: 60000 })
      log('解压完成')
    } else {
      log('缓存中无对应版本，运行 electron install.js 下载...')
      try {
        execSync('node install.js', { cwd: electronPkgDir, stdio: 'inherit', timeout: 120000 })
      } catch (err) {
        fail(`install.js 失败: ${err.message}，请检查网络后手动运行 node node_modules/electron/install.js`)
      }
    }
  }

  if (!isBundleComplete(appPath)) {
    fail('Electron.app 仍不完整，请检查网络并手动运行 node node_modules/electron/install.js')
  }

  log(`Electron.app 完整 ✓ (v${electronVersion})`)

  // 移除隔离属性——必须在签名前执行，否则 macOS Gatekeeper 可能
  // 在签名完成之前就将 .app 标记为恶意软件并移入废纸篓
  log('移除隔离属性...')
  removeQuarantine(appPath)
  // 递归清除内部所有二进制和 framework 的隔离属性
  try {
    execSync(`xattr -dr com.apple.quarantine "${appPath}" 2>/dev/null`, { timeout: 5000 })
    log('隔离属性已清除')
  } catch { /* 某些文件可能没有该属性，忽略 */ }

  // 身份改造 + 签名检查与修复
  // 重装 electron 后 bundle id 会被重置为 com.github.Electron，需重新改造并签名。
  const currentId = getBundleId(appPath)
  const needRebrand = currentId !== DESIRED_BUNDLE_ID
  if (needRebrand) {
    log(`身份为 ${currentId || '未知'}，改造为 ${DESIRED_BUNDLE_ID} ...`)
    try {
      rebrand(appPath)
    } catch (err) {
      warn(`改造 Info.plist 失败: ${err.message}`)
    }
  }

  if (!needRebrand && hasValidSignature(appPath)) {
    log(`Electron 身份 ${DESIRED_BUNDLE_ID}，签名有效 ✓`)
  } else {
    log('正在 adhoc 签名...')
    try {
      execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'pipe', timeout: 30000 })
      log('签名完成 ✓')
    } catch (err) {
      warn(`签名失败: ${err.message}`)
      process.exit(0)
    }
  }

  // 确保 path.txt 存在（electron 的 install.js 用它判断已安装）
  if (!existsSync(pathTxt)) {
    writeFileSync(pathTxt, 'Electron.app/Contents/MacOS/Electron')
    log('已创建 path.txt')
  }

  // 确保 dist/version 存在（electron install.js 的 isInstalled() 检查此文件）
  const distVersionFile = path.join(distDir, 'version')
  const currentDistVersion = (() => {
    try { return readFileSync(distVersionFile, 'utf-8').trim() } catch { return '' }
  })()
  if (currentDistVersion !== electronVersion) {
    writeFileSync(distVersionFile, electronVersion)
    log(`已写入 dist/version: ${electronVersion}`)
  }

  log('完成 ✓')
})()
