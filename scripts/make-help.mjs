#!/usr/bin/env node

/**
 * make-help.mjs — 跨平台的 Makefile 帮助信息生成器
 *
 * 解析 Makefile 中形如 `target: ## 描述` 的注释，
 * 格式化输出可用命令列表（带 ANSI 颜色）。
 *
 * 用法：node scripts/make-help.mjs [Makefile 路径]
 *
 * 替代原 Makefile 中依赖 Unix awk 的 help 目标，
 * 使其在 Windows / macOS / Linux 上均可正常工作。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── ANSI 颜色码 ──────────────────────────────────────────────
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

// ── 确定要解析的 Makefile 路径 ───────────────────────────────
// 默认读取项目根目录下的 Makefile
const __dirname = dirname(fileURLToPath(import.meta.url));
const makefilePath = process.argv[2] ?? join(__dirname, '..', 'Makefile');

// ── 读取 Makefile 内容 ───────────────────────────────────────
const content = readFileSync(makefilePath, 'utf8');
// 使用 /\r?\n/ 同时兼容 CRLF（Windows）和 LF（Unix）行尾
// 若仅用 split('\n')，CRLF 文件中每行会残留 \r，
// 而 JavaScript 的 . 不匹配 \r（行终止符），导致正则失败
const lines = content.split(/\r?\n/);

// ── 匹配 `target: ## 描述` 格式的行 ──────────────────────────
// 目标名允许：字母、数字、下划线、连字符
// `##` 后的文本即为帮助描述
const pattern = /^([a-zA-Z0-9_-]+):\s*.*?##\s*(.+)$/;

const entries = [];
for (const line of lines) {
  const match = line.match(pattern);
  if (match) {
    entries.push({ name: match[1], desc: match[2] });
  }
}

// ── 输出格式化帮助信息 ───────────────────────────────────────
console.log('可用命令：');
for (const { name, desc } of entries) {
  // 目标名左对齐填充至 16 字符，与原 awk 版本保持一致
  const padded = name.padEnd(16);
  console.log(`  ${CYAN}${padded}${RESET} ${desc}`);
}
