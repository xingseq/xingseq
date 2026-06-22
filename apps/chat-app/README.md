# @xingseq/chat-app

L4 应用：**交互式多轮对话 CLI**，含 tool_calls 工具调用循环。

## 串通的能力链路

```
shared-utils (env 注入)
  → config-core (API Key)
  → llm-core (executeChat 流式对话)
  → tool-registry (工具注册 + dispatch)
  → memory-store (对话索引 + 完整文件)
```

## 内置示例工具

| 工具 | 说明 |
|---|---|
| `get_time` | 当前系统时间，支持 iso/locale/unix 三种格式 |
| `read_file` | 读取工作目录内文件（≤64KB，禁越权） |
| `list_dir`  | 列出目录内容 |

## 命令行用法

```bash
# 默认进入交互式 REPL（dry 模式，mock LLM，验证闭环）
npm run dry --workspace=@xingseq/chat-app

# live 模式（真实调用 DeepSeek，需 API Key）
DEEPSEEK_API_KEY=sk-xxx npm run live --workspace=@xingseq/chat-app

# 单轮快速测试
node src/cli.mjs --once "现在几点了"
node src/cli.mjs --once --live "帮我读 package.json"

# 查看历史对话
node src/cli.mjs --list

# 恢复历史对话继续聊
node src/cli.mjs --resume chat-1782141846773
```

## REPL 命令

```
:help        显示帮助
:tools       列出已注册工具
:history     显示当前对话历史
:save        保存对话到 memory-store
:clear       清空当前会话
:quit, :q    直接退出（不保存）
:exit        保存并退出
```

## 编程方式接入

```js
import { createChatSession, createDemoRegistry } from '@xingseq/chat-app'

const session = createChatSession({
  registry: createDemoRegistry({ cwd: process.cwd() })
})

await session.chat('现在几点了？', {
  apiKey: 'sk-xxx',
  onChunk: ({ type, content }) => process.stdout.write(content || ''),
  onToolCall: (tc) => console.log(`调用 ${tc.function.name}`),
  onToolResult: (tc, res) => console.log(`结果`, res)
})

await session.save()
```

## live 模式跑通的前置条件

1. 已配置 `DEEPSEEK_API_KEY` 环境变量，或在 develop 仓库的配置文件里写好 API Key（config-core 会读取）
2. 终端能访问 DeepSeek 服务（如需代理，已通过 shared-utils + config-core 自动接管）
3. 默认使用 deepseek-chat 模型；若要换模型，传 `customParams.subModel` 或 `provider` 参数

## 当前限制（与 develop 版相比）

| 能力 | 状态 |
|---|---|
| 多轮对话 + 工具循环 | ✅ |
| 流式输出 | ✅ |
| 对话保存/加载 | ✅ |
| 工具调用安全确认 | ❌（dry 默认通过；上层可挂 tool-registry 的 confirmation） |
| 联网搜索 / 工具组动态加载 / fallback 模型 | ❌（按需后续接入） |
| 前端 UI | ❌（目前只有 CLI；后续可复用 chatSession） |
# @xingseq/chat-app

L4 应用：开始对话（Chat）

- 计划阶段：阶段 4
- 当前状态：脚手架占位，尚未迁入代码

迁入来源与边界详见根目录 README 与拆分蓝图。
