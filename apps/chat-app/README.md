# @xingseq/chat-app

L4 应用：**交互式多轮对话 CLI**，含 tool_calls 工具调用循环 + 工作区记忆隔离。

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

> chat-app 自带的工具组**只读**：不会写入或删除 workspace 文件。写权限留给未来的 workspace-app。

## 串通的能力链路

```
shared-utils (env 注入 + cli logger)
  → config-core (API Key)
  → llm-core (executeChat 流式对话)
  → tool-registry (工具注册 + dispatch)
  → workspaceStore (workspace 级独立对话历史)
```

## 内置工具组（绑定 workspace.filesDir）

| 工具 | 说明 |
|---|---|
| `get_time` | 当前系统时间（iso/locale/unix） |
| `read_file` | 读 workspace 内文件（≤64KB，禁越权） |
| `list_dir`  | 列 workspace 内目录（禁越权） |

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

1. 配置 `DEEPSEEK_API_KEY` 环境变量，或在 develop 配置文件里写好（config-core 会读）
2. 终端能访问 DeepSeek 服务
3. 默认 `deepseek-chat`；要换模型可传 `customParams.subModel` 或 `provider`

## 与 workspace-app 的边界（未来）

| 维度 | chat-app | workspace-app（计划中） |
|---|---|---|
| 默认 workspace | ✅ 单一固定 (`default`) | ✅ 多工作区，可创建/切换 |
| 工具作用域 | 锁死在 `<workspace>/files` | 每个 workspace 独立沙箱 |
| 读 (`list_dir` / `read_file`) | ✅ | ✅ |
| 写 (`write_file` / `mkdir`) | ❌（默认只读） | ✅（显式开启） |
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
| 工具调用安全确认 | ❌（dry 默认通过） |
| 写文件 / 联网搜索 / 动态工具组 | ❌（留给 workspace-app / 后续） |
| 任意路径作为 workspace | ❌（仅支持 name；留给 workspace-app） |
| 前端 UI | ❌（CLI only；可复用 chatSession） |
