# @xingseq/workspace-app

L4 应用：工作区操作助手。

## 定位

workspace-app 是面向**具体项目目录**的 AI 操作助手，与 chat-app（通用对话入口）的核心差异：

| 能力 | chat-app | workspace-app |
|------|----------|---------------|
| 工作区 | 仅名称式 | **支持挂载任意绝对路径** |
| 工具集 | 默认只读 | **默认启用写工具**（fs/shell） |
| 安全 | - | **四层防护**（确认 + 路径校验 + 白名单 + 参数过滤） |
| UI | 纯对话 | **文件树面板 + 对话** |
| 端口 | 3001 | 3002 |

## 快速开始

```bash
# 装配验证（无需 API Key）
node src/cli.mjs --dry

# 默认工作区交互
node src/cli.mjs --live

# 挂载本地目录
node src/cli.mjs --workspace-path /path/to/your/project

# 名称式工作区
node src/cli.mjs --workspace myproject

# 单轮模式
node src/cli.mjs --once "列一下文件"

# 列出所有工作区
node src/cli.mjs --list

# 启动 HTTP 服务
node src/server.mjs

# 启动前端开发服务器
cd web && npm install && npm run dev
```

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| GET | /api/workspaces | 工作区列表 |
| POST | /api/workspace/mount | 挂载绝对路径为工作区 |
| GET | /api/files?workspace=&path= | 文件树 |
| GET | /api/file?workspace=&path= | 读取单文件 |
| GET | /api/conversations?workspace= | 对话列表 |
| GET | /api/conversation/:id?workspace= | 加载对话 |
| POST | /api/conversation/new?workspace= | 新建对话 |
| DELETE | /api/conversation/:id?workspace= | 删除对话 |
| POST | /api/chat?workspace= | SSE 流式对话 |
| POST | /api/confirm | 确认/拒绝敏感操作 |

支持通过 `workspacePath` 查询参数传入绝对路径挂载。

Web 前端顶栏提供「+ 挂载」按钮，可输入任意绝对路径并即时切换工作区；已挂载目录会保存在 `~/.xingseq/workspace-app/memory/<hash>/meta.json` 中，下次启动仍可从下拉框选择。

## 架构

```
workspace-app (L4)
  ├── provider.mjs     IChatProvider 工厂（当前 chat-core，预留 ai-butler）
  ├── workspace.mjs    工作区解析（增强版，支持绝对路径）
  ├── server.mjs       HTTP + SSE 服务
  ├── cli.mjs          交互式 CLI
  └── web/             Vite + React 前端（文件树 + 对话）

依赖：
  @xingseq/chat-core   → 对话引擎 + 工具编排
  @xingseq/tool-registry → 确认管理器
  @xingseq/shared-utils  → 环境注入
  @xingseq/config-core   → API Key 管理
```

铁规：不 import chat-app 的任何文件，只依赖 L3 及以下包。
# @xingseq/workspace-app

L4 应用：开始操作（WorkspaceChat）

- 计划阶段：阶段 4
- 当前状态：脚手架占位，尚未迁入代码

迁入来源与边界详见根目录 README 与拆分蓝图。
