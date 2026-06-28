# 星序引擎：统一对话接口与递归组合架构

## 1. 核心问题

> "Chat 调用 LLM，Agent 调用 Chat，Agent 对外又像 LLM"——这不是循环依赖，而是**协议一致性**。

类比：HTTP 反向代理既是 Server（对下游）又是 Client（对上游），但没有人觉得这是怪圈。原因是它遵循同一个协议（HTTP），只是在不同层级做了不同的增强。

---

## 2. 设计原则：协议即边界

```
┌─────────────────────────────────────────────────────┐
│              IChatProvider 接口契约                    │
│                                                     │
│  chat(content, options?) → ChatResult               │
│  messages: ChatMessage[]                            │
│  clear() / save() / load()                          │
└─────────────────────────────────────────────────────┘
         ▲              ▲              ▲
         │              │              │
    ┌────┴────┐   ┌────┴────┐   ┌────┴────┐
    │ llm-core│   │chat-core│   │  agent   │
    │         │   │         │   │ -runtime │
    └─────────┘   └────┬────┘   └────┬────┘
                       │              │
                  内部消费 llm-core   内部消费 chat-core
```

**关键规则**：每一层**实现** `IChatProvider`，同时**消费**下一层的 `IChatProvider`。对外暴露的接口形态完全一致。

---

## 3. 三层实现的内部差异

| 层级 | 包名 | 内部行为 | 对外语义 |
|------|------|---------|---------|
| **L1 裸模型** | `@xingseq/llm-core` | 单次 API 调用（OpenAI/本地模型），无状态 | "一个 LLM" |
| **L3 对话引擎** | `@xingseq/chat-core` | 多轮历史 + 工具调度循环 + 流式 + 安全确认 | "会用工具的 LLM" |
| **L3 智能体** | `@xingseq/agent-runtime` | 规划 + 记忆 + 多步推理 + 子任务分解 | "会思考的 LLM" |

### 伪代码对比

```javascript
// llm-core：一次调用
class LLMProvider implements IChatProvider {
  async chat(content) {
    return await openai.chat.completions.create({ messages: [...] })
  }
}

// chat-core：工具循环
class ChatSession implements IChatProvider {
  constructor(llm: IChatProvider) { ... }  // ← 消费下层接口

  async chat(content) {
    let result = await this.llm.chat(content)
    while (result.hasToolCalls) {
      const toolOutputs = await this.executeTools(result.toolCalls)
      result = await this.llm.chat(toolOutputs)  // 续轮
    }
    return result
  }
}

// agent-runtime：规划 + 委派
class AgentRuntime implements IChatProvider {
  constructor(engine: IChatProvider) { ... }  // ← 消费 chat-core

  async chat(content) {
    const plan = await this.plan(content)        // 分解任务
    for (const step of plan.steps) {
      await this.engine.chat(step.instruction)   // 委派给 chat-core
      await this.reflect(step)                   // 反思结果
    }
    return this.synthesize()                     // 合成最终回复
  }
}
```

---

## 4. 为什么不是循环

```
调用方向（单向）：
  L4 app → agent-runtime → chat-core → llm-core → 外部 API

接口方向（统一）：
  每一层都对外暴露 IChatProvider
```

- **调用方向是单向的**（上层调下层），满足分层铁规
- **接口形态是统一的**（都实现 IChatProvider），所以看起来"都像 LLM"

这不是循环，这是**俄罗斯套娃**——每一层包装了下一层，但穿的是同一件衣服。

---

## 5. 实际收益

### 5.1 运行时可插拔

```javascript
// chat-app: 简单场景用 chat-core
const provider = createChatSession({ llm: openaiProvider })

// workspace-app: 复杂场景用 agent-runtime
const provider = createAgentRuntime({ engine: chatSession })

// 对 MailGateway / CLI / Web 入口完全透明
mailGateway.setProvider(provider)  // 不关心是哪层实现
```

### 5.2 渐进增强

```
日常对话 → chat-core（省 token）
复杂任务 → agent-runtime（多步规划）
同一个应用内可运行时切换，应用层代码零改动
```

### 5.3 嵌套组合

```javascript
// Agent A 的 "LLM" 其实是 Agent B
const specialistAgent = createAgentRuntime({ engine: chatCore, tools: codingTools })
const coordinatorAgent = createAgentRuntime({ engine: specialistAgent, tools: delegationTools })
// coordinator 把子任务委派给 specialist，specialist 对外也是 IChatProvider
```

---

## 6. 落地路径

```
当前已完成：
  ✅ IChatProvider 契约定义 (chat-core/src/IChatProvider.js)
  ✅ chat-core 实现 IChatProvider（工具循环 + 流式）
  ✅ chat-app 作为 L4 薄壳消费 chat-core

下一步：
  ⏳ agent 实现 IChatProvider（5 器官框架 + 职业星序图）
  ⏳ agent-runtime 实现多 agent 调度与通信
  ⏳ agent-runtime 内部消费 chat-core 作为执行引擎
```

---

## 7. 边界划分速查

| 问题 | 归属 |
|------|------|
| "把 messages 发给模型拿回响应" | llm-core |
| "响应里有 tool_calls，执行后继续轮询" | chat-core |
| "这个任务太复杂，先拆成 3 步再逐步执行" | agent |
| "这 3 步分别交给不同的专家 agent" | agent-runtime |

---

## 8. 与现有分层架构的映射

```
L1 基座层
  └── llm-core          → IChatProvider 最简实现（裸 API 调用）

L2 领域层
  └── tool-registry     → 工具注册/分发（被 chat-core 消费）
  └── memory-store      → 记忆存储（被 agent-runtime 消费）

L3 能力层
  └── chat-core         → IChatProvider + 工具循环
  └── agent             → IChatProvider + 5 器官框架 + 职业星序图
  └── agent-runtime     → 多 agent 调度、通信、生命周期

L4 应用层
  └── chat-app          → CLI/Web 入口，消费任意 IChatProvider
  └── workspace-app     → 工作区管理，消费 agent-runtime
```

铁规不变：**上层仅依赖下层，同层禁止互引**。统一接口让切换实现变成一行 import 的事。

---

## 9. 总结

一句话：**每块积木形状一样（IChatProvider），但内部复杂度递增。调用方只看形状，不看内部。**

这是装饰器模式 + 策略模式的组合应用，在 AI 应用架构中的最佳实践。
