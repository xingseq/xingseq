#!/usr/bin/env node
/**
 * 启动 Electron 综合控制台
 *
 * macOS 上必须经 LaunchServices（open）启动，而非从终端直接拉起：
 *   从终端启动时 TCC 权限的「责任进程」是终端本身，
 *   给 XingSeq（Electron.app）授予的「完全磁盘访问」不会被使用，
 *   导致子应用（如 folder-sync 的 rsync）访问 ~/Documents 等受保护目录被拒。
 *   经 open 启动后 App 为自己负责，授权才真正生效。
 *
 * 注意：open 方式启动后主进程日志不再输出到终端，可通过 Console.app 查看。
 *
 * 用法：node scripts/launch-electron.mjs
 */

import { spawn, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const mainPath = path.join(rootDir, 'apps', 'electron-shell', 'src', 'main.mjs')

function log(msg) { console.log(`[launch-electron] ${msg}`) }

if (process.platform === 'darwin') {
  const appPath = path.join(rootDir, 'node_modules', 'electron', 'dist', 'Electron.app')
  if (!existsSync(appPath)) {
    console.error('[launch-electron] Electron.app 不存在，请先运行 make install')
    process.exit(1)
  }
  execFileSync('open', ['-n', appPath, '--args', mainPath], { stdio: 'inherit' })
  log('已通过 LaunchServices 启动控制台（日志见 Console.app，终端可安全关闭）')
} else {
  // 非 macOS 无 TCC 归责问题，保持原有终端直启方式
  const child = spawn('npm', ['start', '-w', 'apps/electron-shell'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  child.on('exit', code => process.exit(code ?? 0))
}
