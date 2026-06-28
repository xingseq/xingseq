# @xingseq/chat-core

**L3 对话引擎核心包**。把 chat-app 沉淀的"LLM 交互运行时"能力下沉为可复用 package，供所有 L4 应用共享（chat-app / workspace-app / chatroom-app / flow-studio 等）。

## 架构原则：IChatProvider 统一接口

L3 三个包都是同一个接口的不同实现，从消费方视角等价：

| 包 | 内部在干什么 | 对外看起来 |
|---|---|---|
| `llm-core`  | 一次模型 API 调用 | 「一个 LLM」 |
| `chat-core` | 1 次 → N 次 LLM 调用 + 工具循环 + workspace | 「会自动调工具的 LLM」 |
| `agent`     | 5 器官框架 + 职业星序图 | 「会思考的 LLM」 |

三者都是「给它消息，它回你内容」：

```js
const reply = await provider.chat(userMessage, { onChunk })
```

切换实现 = 一行代码改 import，应用层零改动。契约定义见 [src/IChatProvider.js](./src/IChatProvider.js)。

```js
// 简单场景
import { createChatSession } from '@xingseq/chat-core'
const provider = createChatSession({ workspace, registry })

// 复杂场景（计划中）——同一个应用可运行时升级
import { createAgent } from '@xingseq/agent'
const provider = createAgent({ workspace })

// 以上两种 → 统一调用、统一返回
await provider.chat('帮我创建个项目')
```

## 职责

| 模块 | 职责 |
|---|---|
| `chatSession` | 会话状态 + 工具循环 + workspace 级持久化 |
| `chatLoop` | LLM 调用 + `tool_calls` 派发 + 流式输出 + 确认管理 |
| `workspace` | workspace 解析 / 创建 / 列举（一等公民） |
| `workspaceStore` | workspace 级对话历史（独立 JSON） |
| `security` | 路径越权防护 + 命令白名单 + 参数过滤 |
| `tools/workspace` | 只读工具组：`get_time` / `read_file` / `list_dir` |
| `tools/fs` | 写工具组：`set_file_content` / `replace_file_string` / `create_directory` / `delete_file` |
| `tools/shell` | 命令工具组：`execute_command`（argv + bash -c 兜底） |
| `tools/web` | 联网工具组：`web_search`（Tavily/Bing） / `web_fetch`（SSRF 防护） |

## 不负责什么

- ❌ HTTP/SSE 服务（chat-app/server.mjs 自己做）
- ❌ CLI 交互 REPL（chat-app/cli.mjs 自己做）
- ❌ Web UI / Electron（各 L4 应用自己做）

## 快速开始

```js
import { setSharedEnv } from '@xingseq/shared-utils/env'
import {
  resolveWorkspace,
  ensureWorkspace,
  createWorkspaceRegistry,
  createChatSession
} from '@xingseq/chat-core'

setSharedEnv({ /* ... */ })
const ws = resolveWorkspace({ workspace: 'default' })
await ensureWorkspace(ws)

const registry = createWorkspaceRegistry({
  workspace: ws,
  enableFs: true,
  enableShell: true,
  enableWeb: true
})
const session = createChatSession({ workspace: ws, registry })

await session.chat('帮我读一下 README.md', {
  onChunk: (text) => process.stdout.write(text)
})
```

## 工具组按需启用

```js
const registry = createWorkspaceRegistry({
  workspace: ws,
  enableWeb: false,   // 禁用联网
  enableFs: false,    // 只读模式
  enableShell: false
})
// 之后用 registry.register('myGroup', { ... }) 注册 app 自己的工具
```

## 安全机制（与 xingseq-develop 一致）

四层防护：
1. **前端确认**：Web 端 30s 倒计时弹窗 / CLI 默认放行（与 develop 一致）
2. **路径校验**：`resolveSafePath`，越权抛错
3. **命令白名单**：仅标准模式（npm / git / node / ls / cat / grep 等）
4. **参数过滤**：` ; \` $ ( ) < > | & ` 等危险字符

工具命名严格对齐 develop（`set_file_content` / `execute_command` 等），自动命中 `tool-registry` 的 `DEFAULT_SENSITIVE_TOOLS`，零重复维护。

## 包结构

```
packages/chat-core/
├── package.json
├── README.md
└── src/
    ├── index.js            ← 统一对外入口
    ├── chatSession.js      ← 会话 + registry 工厂
    ├── chatLoop.js         ← LLM tool_calls 循环
    ├── workspace.js        ← workspace 解析/创建/列举
    ├── workspaceStore.js   ← 对话历史持久化
    ├── security.js         ← 路径/命令/参数安全
    └── tools/
        ├── workspace.js    ← 只读工具组
        ├── fs.js           ← 文件写工具组
        ├── shell.js        ← shell 工具组
        └── web.js          ← 联网工具组
```

## 来源

抽取自 `apps/chat-app/src/`（chatSession.js、chatLoop.js、workspace.js、workspaceStore.js、security.js、tools.js、fsTools.js、shellTools.js、webTools.js）。`chat-app` 现已变为薄壳，只保留 CLI / Server / Web 入口。
