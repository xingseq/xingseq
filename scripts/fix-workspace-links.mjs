#!/usr/bin/env node
/**
 * fix-workspace-links.mjs
 *
 * 修复 Windows 上 npm workspaces 创建的 junction 无法遍历的问题。
 *
 * 背景：
 *   Windows 11 (build 26200+) 引入了"untrusted mount point"安全策略，
 *   导致 npm 为 workspace 包创建的 junction（挂载点）无法被遍历。
 *   表现为 lstat/open 通过 junction 访问文件时报 UNKNOWN (-4094) 错误。
 *
 * 本脚本：
 *   1. 扫描 node_modules/@xingseq/ 下的所有 junction
 *   2. 删除不可遍历的 junction
 *   3. 用目录拷贝（fs.cpSync）替代 junction，使模块解析恢复正常
 *
 * 用法：
 *   node scripts/fix-workspace-links.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scopedDir = path.join(root, 'node_modules', '@xingseq');

// 检查 @xingseq 目录是否存在
if (!fs.existsSync(scopedDir)) {
  console.error('[fix-links] node_modules/@xingseq 不存在，请先运行 npm install --no-bin-links');
  process.exit(1);
}

let fixed = 0;
let skipped = 0;
let failed = 0;

for (const name of fs.readdirSync(scopedDir)) {
  const linkPath = path.join(scopedDir, name);

  // 检查是否为 junction/symlink
  let stat;
  try {
    stat = fs.lstatSync(linkPath);
  } catch {
    console.error(`  ✗ ${name}: lstat 失败，跳过`);
    failed++;
    continue;
  }

  if (!stat.isSymbolicLink()) {
    // 已经是普通目录，无需处理
    console.log(`  = ${name}: 已是普通目录，跳过`);
    skipped++;
    continue;
  }

  // 尝试遍历 junction，判断是否可用
  let traversable = false;
  try {
    fs.statSync(linkPath);
    traversable = true;
  } catch {
    traversable = false;
  }

  if (traversable) {
    console.log(`  ✓ ${name}: junction 可遍历，跳过`);
    skipped++;
    continue;
  }

  // 确定 junction 的真实目标路径
  // npm workspaces 的 junction 目标通常是 packages/<name> 或 apps/<name>
  const candidates = [
    path.join(root, 'packages', name),
    path.join(root, 'apps', name),
  ];

  let sourcePath = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      sourcePath = candidate;
      break;
    }
  }

  if (!sourcePath) {
    console.error(`  ✗ ${name}: 找不到源目录 (packages/${name} 或 apps/${name})`);
    failed++;
    continue;
  }

  // 删除损坏的 junction，然后拷贝真实目录
  try {
    fs.rmSync(linkPath, { force: true });
  } catch {
    // junction 可能需要特殊删除方式
    try {
      fs.rmdirSync(linkPath);
    } catch (e) {
      console.error(`  ✗ ${name}: 删除 junction 失败: ${e.message}`);
      failed++;
      continue;
    }
  }

  try {
    // 递归拷贝源目录到 node_modules/@xingseq/<name>
    // 使用 recursive + filter 排除 node_modules 子目录，避免拷贝嵌套依赖
    fs.cpSync(sourcePath, linkPath, {
      recursive: true,
      filter: (src) => {
        // 排除 node_modules、.git、dist 等目录
        const rel = path.relative(sourcePath, src);
        if (!rel) return true; // 根目录本身
        const parts = rel.split(path.sep);
        if (parts[0] === 'node_modules') return false;
        if (parts[0] === '.git') return false;
        return true;
      },
    });
    console.log(`  ✓ ${name}: 已用目录拷贝替代 junction (源: ${path.relative(root, sourcePath)})`);
    fixed++;
  } catch (e) {
    console.error(`  ✗ ${name}: 拷贝失败: ${e.message}`);
    failed++;
  }
}

console.log(`\n[fix-links] 完成: ${fixed} 已修复, ${skipped} 已跳过, ${failed} 失败`);

if (failed > 0) {
  process.exit(1);
}
