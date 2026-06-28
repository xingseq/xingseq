# @xingseq/llm-core

L1 基座层 — 多 Provider LLM 客户端与流式对话执行。

## 职责

封装 DeepSeek / Kimi / Qwen / Doubao 四家 LLM 的请求构建、流式解析、错误标准化、会话控制，对上层暴露统一的 `executeChat` 高层 API。

## 子路径 exports

| 路径 | 主要 API |
| ---- | -------- |
| `@xingseq/llm-core/clients` | `createDeepSeekClient` / `createKimiClient` / `createQwenClient` / `createDoubaoClient` / `createClient` / `refreshProxyAgent` |
| `@xingseq/llm-core/requestBuilder` | `buildRequestParams({messages, mode, customParams, tools, provider, subModel})` / `addSystemPrompt` |
| `@xingseq/llm-core/streamParser` | `parseStream(stream, onChunk)` |
| `@xingseq/llm-core/errorHandler` | `parseApiError` / `logApiError` / `isRetryableWithFallback` |
| `@xingseq/llm-core/sessionManager` | `createSessionController` / `abortSession` / `cleanupSession` |
| `@xingseq/llm-core/executeChat` | `executeChat({apiKey, messages, provider, mode, customParams, tools, sessionId, onChunk})` |
| `@xingseq/llm-core` | 上述全部聚合 barrel |

## 使用示例

```js
import { executeChat } from '@xingseq/llm-core/executeChat'

const result = await executeChat({
  apiKey: 'sk-...',
  messages: [{ role: 'user', content: 'Hello' }],
  provider: 'deepseek',       // 'deepseek' | 'kimi' | 'qwen' | 'doubao'
  mode: 'chat',               // 'chat' | 'reasoner' | 'ep-xxx'(doubao)
  customParams: { temperature: 1.0, systemPrompt: 'You are helpful' },
  onChunk: ({ type, content, done }) => process.stdout.write(content || '')
})

if (result.success) {
  console.log(result.fullContent)
}
```

## 设计要点

- `apiKey` 显式入参，不读 configManager — 解耦配置层。
- `tools` 显式入参（OpenAI tools 数组格式）— 不自动加载工具定义。
- 不递归处理 `tool_calls`；首轮返回 `toolCalls` 数组，工具循环由上层（chat-core）驱动。
- 所有 Provider 统一走 OpenAI SDK 兼容协议。

## 外部依赖

- `openai@^4.77.0`
- `https-proxy-agent@^7.0.2`
- `@xingseq/shared-utils`（同 workspace）

## 测试

```bash
npm test --workspace=@xingseq/llm-core
```

smoke 测试覆盖：parseStream、buildRequestParams、parseApiError、客户端创建、executeChat 完整流水线（mock stream）。
# @xingseq/llm-core

L1 基座层 - 多 provider LLM 客户端、请求构建、流式解析、错误标准化、会话控制。

## 来源

迁入自 `electron/ai/` 下的：

| 源文件                | 当前位置                  | 改动 |
| --------------------- | ------------------------- | ---- |
| `aiClient.js`         | `src/clients.js`          | logger / proxyManager 改自 `@xingseq/shared-utils` |
| `requestBuilder.js`   | `src/requestBuilder.js`   | 去除对 `tools/toolDefinitions.js` 的依赖；`tools` 改为入参（OpenAI tools 数组） |
| `streamParser.js`     | `src/streamParser.js`     | 与 develop 完全一致 |
| `errorHandler.js`     | `src/errorHandler.js`     | logger / providerConstants 改自 `@xingseq/shared-utils` |
| `sessionManager.js`   | `src/sessionManager.js`   | logger 改自 `@xingseq/shared-utils`；新增 `__resetForTest` |
| —                     | `src/executeChat.js`      | **新增** L1 自有高层 API（不依赖 chatFlow / configManager） |

未迁入（属于 L2/L3）：
- `chatFlow.js` —— 完整对话编排（工具调用循环、备用模型、搜索代理）
- `aiServiceCore.js` —— 依赖 chatFlow + configManager
- `toolCallRunner.js` / `toolGroupLoader.js` —— 工具执行
- `searchAgent.js` / `docUpdateAgent.js` / `postChatAnalyzer.js` —— 业务代理
- `embeddingService.js` —— 单独成包候选
- `imageClient.js` —— 独立 image 子包候选

## 安装

依赖会通过 npm workspaces 自动 link：

```bash
npm install --workspace=@xingseq/llm-core
```

外部依赖：
- `openai@^4.77.0`（多 provider 都用 OpenAI SDK 兼容协议）
- `https-proxy-agent@^7.0.2`
- `@xingseq/shared-utils`（同 workspace）

## 子路径 exports

| 路径 | 主要 API |
| ---- | -------- |
| `@xingseq/llm-core/clients`         | `createDeepSeekClient` / `createKimiClient` / `createQwenClient` / `createDoubaoClient` / `createClient` / `refreshProxyAgent` / 模型映射表 |
| `@xingseq/llm-core/requestBuilder`  | `buildRequestParams({messages, mode, customParams, tools, provider, subModel})` / `addSystemPrompt` |
| `@xingseq/llm-core/streamParser`    | `parseStream(stream, onChunk)` |
| `@xingseq/llm-core/errorHandler`    | `parseApiError` / `logApiError` / `isRetryableWithFallback` |
| `@xingseq/llm-core/sessionManager`  | `createSessionController` / `abortSession` / `cleanupSession` |
| `@xingseq/llm-core/executeChat`     | `executeChat({apiKey, messages, provider, mode, customParams, tools, sessionId, onChunk})` |
| `@xingseq/llm-core`                 | 上述全部聚合 barrel |

## 高层 API：executeChat

```js
import { executeChat } from '@xingseq/llm-core/executeChat'

const result = await executeChat({
  apiKey: 'sk-...',              // 必填，由调用方注入
  messages: [{ role: 'user', content: 'Hello' }],
  provider: 'deepseek',          // 'deepseek'|'kimi'|'qwen'|'doubao'
  mode: 'chat',                  // 'chat'|'reasoner'|'ep-xxx'(doubao)
  customParams: { temperature: 1.0, systemPrompt: 'You are helpful' },
  onChunk: ({ type, content, done }) => process.stdout.write(content || '')
})

if (result.success) {
  console.log(result.fullContent)
}
```

与 develop `aiServiceCore.chat` 的区别：
- `apiKey` 显式入参，不读 `configManager`
- 工具（`tools`）显式入参，不动态加载工具组
- 不递归处理 `tool_calls`，首轮结果返回 `toolCalls` 数组，下一轮由上层决定

工具调用循环、搜索代理等属于上层编排，将在 `flow-engine` / `agent-runtime` 等 L2/L3 包实现。

## 测试

```bash
npm test --workspace=@xingseq/llm-core
```

smoke 测试用 mock stream 验证：
- `parseStream` 解析普通内容 / reasoning_content / tool_calls
- `buildRequestParams` 各 provider 选模型逻辑 + tools 注入
- `parseApiError` 各错误码标准化
- 客户端创建（不实际发请求）
- `executeChat` 用 mock client 走通完整流水线
