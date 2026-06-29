#!/usr/bin/env node

/**
 * dev-concurrent.mjs — 跨平台并发进程启动器
 *
 * 同时启动两个 npm workspace 脚本（例如后端 server + 前端 web），
 * 任一进程退出或收到 Ctrl+C 时自动终止所有子进程。
 *
 * 用法：node scripts/dev-concurrent.mjs <workspace> <script1> <script2>
 * 示例：node scripts/dev-concurrent.mjs apps/chat-app server web
 *
 * 替代原 Makefile 中依赖 Unix `trap 'kill 0' EXIT` + `&` 的并发方案，
 * 使其在 Windows 上同样可用。
 */

import { spawn } from 'node:child_process';

// ── 参数校验 ─────────────────────────────────────────────────
const [workspace, script1, script2] = process.argv.slice(2);

if (!workspace || !script1 || !script2) {
  console.error(
    '用法: node scripts/dev-concurrent.mjs <workspace> <script1> <script2>'
  );
  console.error('示例: node scripts/dev-concurrent.mjs apps/chat-app server web');
  process.exit(1);
}

// ── 在 Windows 上 npm 通过 npm.cmd 调用，需要 shell:true ─────
const isWindows = process.platform === 'win32';

/** @type {import('node:child_process').ChildProcess[]} */
const procs = [];

/**
 * 启动一个 npm workspace 脚本，stdio 继承父进程（终端直接可见输出）。
 * @param {string} ws - workspace 路径，如 apps/chat-app
 * @param {string} script - 要运行的 npm script 名称
 */
function launch(ws, script) {
  const child = spawn('npm', ['run', script, '-w', ws], {
    stdio: 'inherit',
    shell: isWindows, // Windows 上需要 shell 模式才能找到 npm.cmd
  });
  return child;
}

// ── 启动两个子进程 ───────────────────────────────────────────
procs.push(launch(workspace, script1));
procs.push(launch(workspace, script2));

// ── 任一进程退出时，终止所有进程 ─────────────────────────────
let exiting = false;
procs.forEach((proc) => {
  proc.on('exit', (code, signal) => {
    if (exiting) return;
    exiting = true;
    // 终止其他仍在运行的进程
    procs.forEach((other) => {
      if (other !== proc && !other.killed) {
        other.kill('SIGTERM');
      }
    });
    process.exit(code ?? 0);
  });
});

// ── Ctrl+C (SIGINT) 时优雅终止所有子进程 ────────────────────
process.on('SIGINT', () => {
  exiting = true;
  procs.forEach((proc) => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  });
  process.exit(130); // 128 + SIGINT(2) 的标准退出码
});

// ── SIGTERM（如被其他进程终止）时也清理子进程 ────────────────
process.on('SIGTERM', () => {
  exiting = true;
  procs.forEach((proc) => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  });
  process.exit(143); // 128 + SIGTERM(15) 的标准退出码
});
