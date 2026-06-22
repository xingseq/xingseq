#!/usr/bin/env node
/**
 * 工作区脚手架脚本（阶段 0）
 *
 * 为 packages/* 与 apps/* 下的占位包生成最小化 package.json / README / src/index.js。
 * 幂等：已存在的文件不会被覆盖，方便后续阶段反复运行补齐缺漏。
 *
 * 用法：
 *   node scripts/scaffold-workspace.mjs
 *   npm run scaffold
 *
 * 不从 xingseq-develop 复制任何业务代码，仅生成占位骨架。
 * 实际代码迁入由各阶段单独执行。
 *
 * @created 2026-06-22
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// 包清单：[相对路径, 包名(去前缀), 描述, 计划阶段]
const TARGETS = [
  // L1 基座层
  ['packages/shared-utils',   'shared-utils',   'L1 基座：logger / proxy / timestamp / 通用常量', 1],
  ['packages/config-core',    'config-core',    'L1 基座：API Key、模型默认值、用户偏好、执行配置', 1],
  ['packages/storage-core',   'storage-core',   'L1 基座：SQLite/SQL.js 封装、原子文件写、AES 加密', 1],
  ['packages/llm-core',       'llm-core',       'L1 基座：多 provider LLM 客户端、流式解析、工具调用循环', 1],
  // L2 领域服务层
  ['packages/tool-registry',  'tool-registry',  'L2 领域：工具定义注册中心与统一执行入口', 2],
  ['packages/memory-store',   'memory-store',   'L2 领域：会话 / 消息 / 记忆 / 分析报告存储', 2],
  ['packages/skill-host',     'skill-host',     'L2 领域：skill 下载 / 安装 / 状态 / 清理', 2],
  ['packages/subapp-host',    'subapp-host',    'L2 领域：子应用注册 / 进程 / CLI / UI / 记忆', 2],
  // L3 能力层
  ['packages/ai-butler',      'ai-butler',      'L3 能力：Agent 基类、prompt 体系、规划 / 反思 / 邮件 / 课程', 3],
  ['packages/agent-runtime',  'agent-runtime',  'L3 能力：agent 进程注册、生命周期、邮箱守护、通信（迁自 agent-manager）', 3],
  ['packages/flow-engine',    'flow-engine',    'L3 能力：星序图执行引擎、节点执行器、状态机、DAG', 3],
  // L4 应用层
  ['apps/electron-shell',     'electron-shell', 'L4 应用：Electron 主进程壳、IPC 网关、CLI 入口', 4],
  ['apps/chat-app',           'chat-app',       'L4 应用：开始对话（Chat）', 4],
  ['apps/workspace-app',      'workspace-app',  'L4 应用：开始操作（WorkspaceChat）', 4],
  ['apps/chatroom-app',       'chatroom-app',   'L4 应用：AI 聊天室（ChatRoom）', 4],
  ['apps/flow-studio',        'flow-studio',    'L4 应用：星序图编辑 / 管理', 4]
]

function writeIfAbsent(file, content) {
  if (existsSync(file)) {
    console.log(`skip  ${file}`)
    return false
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
  console.log(`write ${file}`)
  return true
}

function pkgJson(name, description, stage) {
  return JSON.stringify({
    name: `@xingseq/${name}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    description,
    main: 'src/index.js',
    exports: { '.': './src/index.js' },
    scripts: { test: 'echo "no tests yet" && exit 0' },
    xingseq: { stage, status: 'scaffold' }
  }, null, 2) + '\n'
}

function indexJs(name, description) {
  return [
    `/**`,
    ` * @xingseq/${name}`,
    ` * ${description}`,
    ` *`,
    ` * 阶段 0 脚手架占位入口，按拆分计划在对应阶段迁入实际实现。`,
    ` */`,
    `export const __scaffold__ = true`,
    ''
  ].join('\n')
}

function readme(name, description, stage) {
  return [
    `# @xingseq/${name}`,
    '',
    description,
    '',
    `- 计划阶段：阶段 ${stage}`,
    `- 当前状态：脚手架占位，尚未迁入代码`,
    '',
    '迁入来源与边界详见根目录 README 与拆分蓝图。',
    ''
  ].join('\n')
}

let created = 0
for (const [rel, name, desc, stage] of TARGETS) {
  const base = join(root, rel)
  if (writeIfAbsent(join(base, 'package.json'), pkgJson(name, desc, stage))) created++
  if (writeIfAbsent(join(base, 'src', 'index.js'), indexJs(name, desc))) created++
  if (writeIfAbsent(join(base, 'README.md'), readme(name, desc, stage))) created++
}

console.log(`\ndone. created ${created} files; skipped existing.`)
