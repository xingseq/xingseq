# @xingseq/chat-app

L4 应用：**交互式多轮对话**，含 tool_calls 工具调用循环 + 工作区记忆隔离。

两种使用形态：

- **CLI**：`node src/cli.mjs`（交互式 REPL）
- **Web**：`npm run server` + `npm run web`（浏览器对话，Vite + React）

## 架构约定：只依赖 IChatProvider 接口

chat-app 是第一个落地 IChatProvider 抽象的 L4 应用 —— cli / server 里 **不直接** import `createChatSession`，而是通过 [provider.mjs](./src/provider.mjs) 取 IChatProvider 实例：

```js
import { createProvider } from './provider.mjs'

/** @type {import('@xingseq/chat-core').IChatProvider} */
const session = createProvider({ workspace, registry })

await session.chat('你好', { onChunk })
```

| Provider 类型 | 底层实现 | 状态 |
|---|---|---|
| `chat-core` (默认) | `createChatSession`（一次→N 次 LLM + 工具循环） | ✅ 已接入 |
| `agent` | `createAgent`（5 器官框架 + 职业星序图） | 🚧 L3 agent 完成后接入 |

切换方式：

```bash
# 默认 chat-core
node src/cli.mjs

# 切换 agent（暂未实现，会友好报错）
XINGSEQ_PROVIDER=agent node src/cli.mjs
```

切换底层 = 改 `provider.mjs` 一处，cli/server 零改动。契约文档：[@xingseq/chat-core/src/IChatProvider.js](../../packages/chat-core/src/IChatProvider.js)。

## 设计要点

**工作区（workspace）是 chat-app 的一等概念。** 每个 workspace 拥有独立的文件目录和对话历史，互不污染。chat-app 启动时若没有任何 workspace，会自动创建名为 `default` 的默认 workspace 并写入欢迎文件，开箱即用。

```
~/.xingseq/chat-app/                    ← userData（记忆中心）
└── workspaces/
    ├── default/                        ← 默认 workspace
    │   ├── files/                      ← AI 通过 list_dir / read_file 能看到的目录
    │   │   ├── README.md               ← 首次创建时写入的欢迎文件
    │   │   └── NOTES.md
    │   └── memory/                     ← 对话历史（独立）
    │       ├── index.json
    │       └── conversations/<id>.json
    └── mywork/                         ← 自定义 workspace（--workspace mywork）
        ├── files/
        └── memory/
```

> chat-app 内置 4 组工具：`workspace`（只读）、`web`（联网）、`fs`（写文件）、`shell`（执行命令）。**所有写动作都被路径越权防护、命令白名单、参数过滤、Web 端确认弹窗四层兜住**。设计与 [`xingseq-develop`](../../) 三层安全机制（敏感工具确认 + 命令白名单 + 路径黑名单）保持一致。

## 串通的能力链路

```
shared-utils (env 注入 + cli logger)
  → config-core (API Key)
  → llm-core (executeChat 流式对话)
  → tool-registry (工具注册 + dispatch)
  → workspaceStore (workspace 级独立对话历史)
```

## 内置工具组

### `workspace` 组（绑定 workspace.filesDir，只读）

| 工具 | 说明 |
|---|---|
| `get_time` | 当前系统时间（iso/locale/unix） |
| `read_file` | 读 workspace 内文件（≤64KB，禁越权） |
| `list_dir`  | 列 workspace 内目录（禁越权） |

### `web` 组（联网）

| 工具 | 说明 |
|---|---|
| `web_search` | 联网搜索：优先 Tavily（需 key），无 key 自动降级 Bing |
| `web_fetch`  | 抓取 URL 正文（HTML 自动剥标签，≤1 次 512KB，≤1 次 15s） |

**安全约束——`web_fetch`**：
- 仅允许 `http://` / `https://`
- 拒绝 `localhost` / `127.0.0.1` / `10.x` / `172.16-31.x` / `192.168.x` / `169.254.x` 等内网与保留地址（防 SSRF）
- DNS 解析后仍会再判一次，防止域名重定向绕过

### `fs` 组（写文件，敏感）

命名严格对齐 develop，自动命中 `DEFAULT_SENSITIVE_TOOLS`。

| 工具 | 说明 |
|---|---|
| `set_file_content` | 整文件覆盖写入（≤10MB） |
| `replace_file_string` | 局部替换；`old_string` 必须在文件中**唯一出现**，否则报错 |
| `create_directory` | 递归创建目录 |
| `delete_file` | 删文件/目录；非空目录默认拒绝，需显式 `recursive=true`；不能删 workspace 根目录 |

**路径越权防护**：所有路径都经 `resolveSafePath` 计算，`..` / 绝对路径 / 解析后跳出 `workspace.filesDir` 一律抛错。

### `shell` 组（执行命令，敏感）

| 工具 | 说明 |
|---|---|
| `execute_command` | 在 `workspace.filesDir` 内执行命令；**强制 cwd**，不可跨出工作区 |

两种执行模式自动选择：

- **argv 模式**（默认）：`{ command, args[] }` 走白名单。允许 `npm/npx/yarn/pnpm/node/git/make/cmake/python/ls/cat/grep/find/echo/...`；参数若含 `; \` $() <> | &` 等被参数过滤拦截。
- **shell 兜底**：命令文本中检测到 `&&` / `||` / `;` / `|` / `<>` / `\`` / `$()` 时自动用 `bash -c`（macOS/Linux）/ `cmd /c`（Windows）执行整条命令。

输出截断 64KB，默认 30s 超时（最大 5min）。

## 工具确认机制（敏感工具）

复用 `@xingseq/tool-registry` 的 `createConfirmationManager`，行为与 develop 完全一致：

| 模式 | 行为 |
|---|---|
| **CLI** (`isCLI: true`) | 自动放行（与 develop CLI 相同） |
| **Web** (server.mjs) | 每个 SSE 请求独立 manager，倒计时 30s 模式 |

Web 端流程：

```
LLM tool_call → manager 命中敏感工具 → SSE 推 confirm_request 给前端
  ├─ 用户点「立即执行」      → POST /api/confirm { confirmed: true }  → 工具执行
  ├─ 用户点「拒绝」          → POST /api/confirm { confirmed: false } → SSE 推 tool_denied，工具返回 error 给 LLM
  └─ 30s 不操作              → 倒计时结束自动放行（与 develop 默认一致）
```

敏感工具列表（默认）：`set_file_content` / `replace_file_string` / `delete_file` / `create_directory` / `execute_command` / `copy_file` / `move_file` / `download_file` / `launch_application` / `insert_record` / `update_record` / `delete_record` / `create_table`。

## 命令行用法

```bash
# 默认进入交互式 REPL（dry 模式，mock LLM，使用默认 workspace）
node src/cli.mjs

# 切到 / 新建一个 workspace（首次自动创建 + 写欢迎文件）
node src/cli.mjs --workspace mywork

# live 模式（真实调用 DeepSeek，需 API Key）
DEEPSEEK_API_KEY=sk-xxx node src/cli.mjs --live

# 单轮快速测试
node src/cli.mjs --once "现在几点了"
node src/cli.mjs --once "列一下我的工作区有什么文件"
node src/cli.mjs --once "帮我读 README.md"

# 列出当前 workspace 的对话历史
node src/cli.mjs --list

# 列出所有 workspace
node src/cli.mjs --list-workspaces

# 恢复历史对话继续聊（默认 workspace 内）
node src/cli.mjs --resume <chat-id>
node src/cli.mjs --workspace mywork --resume <chat-id>
```

也可以用环境变量永久切换默认 workspace：

```bash
CHAT_APP_WORKSPACE=mywork node src/cli.mjs
```

## REPL 命令

```
:help        显示帮助
:pwd         显示当前 workspace（名称、files 目录、memory 目录）
:ls          列出 workspace 根目录文件
:tools       列出已注册工具
:history     显示当前对话历史
:save        保存当前对话到 workspace 记忆
:clear       清空当前会话消息
:quit, :q    直接退出（不保存）
:exit        保存并退出
```

## 编程方式接入

```js
import {
  resolveWorkspace,
  ensureWorkspace,
  createWorkspaceRegistry,
  createChatSession
} from '@xingseq/chat-app'
import { setSharedEnv } from '@xingseq/shared-utils/env'

// 1. 注入 env（CLI / 自定义入口必须）
setSharedEnv({
  isCLI: true,
  getApp: () => ({ getPath: () => '/path/to/userData', isReady: () => true, whenReady: async () => {} })
})

// 2. 解析 + 准备 workspace（首次自动建欢迎文件）
const workspace = resolveWorkspace({ workspace: 'default' })
await ensureWorkspace(workspace)

// 3. 创建会话
const session = createChatSession({
  workspace,
  registry: createWorkspaceRegistry({ workspace })
})

// 4. 多轮对话 + 工具调用
await session.chat('帮我读 README.md', {
  apiKey: 'sk-xxx',
  onChunk: ({ type, content }) => process.stdout.write(content || ''),
  onToolCall: (tc) => console.log(`调用 ${tc.function.name}`),
  onToolResult: (tc, res) => console.log(`结果`, res)
})

// 5. 保存到 workspace（独立于其他 workspace）
await session.save()
```

## live 模式前置条件

1. 配置 `DEEPSEEK_API_KEY` 环境变量，或写入 `~/.xingseq/chat-app/config/models.json`（config-core 会读）
2. 终端能访问 DeepSeek 服务
3. 默认 `deepseek-chat`；要换模型可传 `customParams.subModel` 或 `provider`

models.json 示例：

```json
{
  "models": [
    {
      "id": "deepseek-default",
      "name": "DeepSeek",
      "provider": "deepseek",
      "apiKey": "sk-xxx",
      "isDefault": true
    }
  ]
}
```

## Tavily 配置（可选，提升 web_search 质量）

不配也能用 —— `web_search` 会自动降级用 Bing。想要更高质量的结果可以去 [tavily.com](https://tavily.com) 领个 free key，写到 `~/.xingseq/chat-app/config/general.json`：

```json
{
  "tavilyApiKey": "tvly-xxxxxxxxxxxx"
}
```

该文件是应用通用配置，config-core 会自动读；web_search 存在时优先走 Tavily，失败静默降级。

## Web 前端（最小版本）

架构：

```
browser  ──▶  vite dev (5173)  ──proxy /api──▶  server.mjs (3001)  ──▶  chatSession  ──▶  llm-core / tool-registry
```

server 用 Node 原生 http，**无 Express 依赖**。前端是独立 Vite + React 子项目（`apps/chat-app/web/`）。

首次启动：

```bash
# 1. 装前端依赖
npm run web:install

# 2. 起 HTTP+SSE 服务（端口 3001）
npm run server

# 3. 起前端 dev server（端口 5173），新开一个终端
npm run web

# 浏览器打开 http://localhost:5173
```

Web 端能力（与 CLI 等价 + 多 workspace 切换）：

- 顶部下拉切换 workspace（独立对话历史）
- 左侧对话列表 + 新建 / 删除
- 流式渲染 LLM 输出（思考过程 + 正文 + 光标闪烁）
- 工具调用气泡：实时显示 ⏳ 调用中 → ✓ 完成（含参数 + 返回结果）
- 多轮 tool_calls 循环全过程可见
- ⌘/Ctrl + Enter 发送

生产部署：`npm run web:build` 产出 `web/dist`，可挂在任意静态服务器后面，配置反向代理把 `/api/*` 转给 `node src/server.mjs`。

### HTTP 接口（也可以用 curl 直接调）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 心跳 |
| GET | `/api/workspaces` | 所有 workspace 列表 |
| GET | `/api/conversations?workspace=xxx` | workspace 内对话索引 |
| GET | `/api/conversation/:id?workspace=xxx` | 加载对话 |
| POST | `/api/conversation/new?workspace=xxx` | 新建空对话 |
| DELETE | `/api/conversation/:id?workspace=xxx` | 删除对话 |
| POST | `/api/chat?workspace=xxx` | **SSE 流式对话**，body `{ conversationId, message }`，事件：`chunk` / `tool_call` / `tool_result` / `tool_denied` / `confirm_request` / `done` / `error` |
| POST | `/api/confirm` | 前端提交确认结果，body `{ confirmId, confirmed }` |

## 与 workspace-app 的边界（未来）

| 概念 | chat-app | workspace-app（计划中） |
|---|---|---|
| 默认 workspace | ✅ 单一固定 (`default`) | ✅ 多工作区，可创建/切换 |
| 工具作用域 | 锁死在 `<workspace>/files` | 每个 workspace 独立沙箱 |
| 读 (`list_dir` / `read_file`) | ✅ | ✅ |
| 写 (`set_file_content` / `delete_file` ...) | ✅（带路径越权防护 + 确认机制） | ✅（独立沙箱内） |
| Shell 命令 | ✅（白名单 + 强制 cwd） | ✅ |
| 工作区元数据 | 无 | 名称/描述/最近访问/标签 |
| 跨 workspace 切换 UI | ❌（只能 `--workspace`） | ✅ |
| 对话与 workspace 绑定 | ✅ | ✅ |

> chat-app 已为 workspace-app 留好接口：`createWorkspaceRegistry({ workspace })` 注册的工具组名为 `'workspace'`，workspace-app 后续可用同名工具组直接覆盖（替换为带写权限版本）。

## 当前限制

| 能力 | 状态 |
|---|---|
| 多轮对话 + 工具循环 | ✅ |
| 流式输出 | ✅ |
| 默认 workspace 自动创建 + 欢迎文件 | ✅ |
| workspace 级对话隔离 | ✅ |
| 工具调用安全确认 | ✅（Web 倒计时弹窗 / CLI 默认放行） |
| 写文件 / 联网搜索 / shell 命令 | ✅（全部含路径越权防护 + 白名单） |
| 动态工具组 | ❌（留给 workspace-app / 后续） |
| 任意路径作为 workspace | ❌（仅支持 name；留给 workspace-app） |
| Web 前端 | ✅（Vite + React，复用 chatSession） |
