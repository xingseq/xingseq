/**
 * IChatProvider —— 星序对话能力统一接口约定
 *
 * 核心思想：
 *   llm-core / chat-core / agent 三个层，对外都暴露同一个 chat() 形态。
 *   消费方（chat-app / workspace-app / chatroom-app / flow-studio）
 *   只 import 接口、不关心底下是「裸模型」「模型+工具循环」还是「多角色协调」。
 *
 * 三个层都满足 IChatProvider：
 *
 *   ┌─────────────┬──────────────────────────────────────────────┐
 *   │ llm-core    │ 一次模型 API 调用                            │
 *   │ chat-core   │ 一次 → N 次 LLM 调用 + 工具循环 + workspace  │
 *   │ agent       │ 5 器官框架 + 职业星序图                       │
 *   └─────────────┴──────────────────────────────────────────────┘
 *
 * 三者从消费方视角等价 —— 都是「给它消息，它回你内容」。
 * 切换实现 = 一行代码改 import，应用层零改动。
 *
 * 本文件只是契约文档（JSDoc typedef），不导出任何运行时对象。
 */

/**
 * @typedef {object} ChatChunk
 * @property {'content'|'reasoning'|'tool_call'|'tool_result'|'done'} type
 * @property {string} [content]
 * @property {object} [data]
 */

/**
 * @typedef {object} ChatToolCall
 * @property {string} id
 * @property {string} name
 * @property {object} args
 */

/**
 * @typedef {object} ChatToolResult
 * @property {string} tool_call_id
 * @property {string} name
 * @property {string} result
 * @property {boolean} [error]
 */

/**
 * @typedef {object} ChatOptions
 * @property {(chunk: ChatChunk) => void}      [onChunk]       流式输出回调
 * @property {(tc: ChatToolCall) => void}      [onToolCall]    工具调用即将执行
 * @property {(tr: ChatToolResult) => void}    [onToolResult]  工具执行完成
 * @property {(td: ChatToolCall) => void}      [onToolDenied]  工具被用户拒绝
 * @property {object}                          [confirmation]  确认管理器（来自 tool-registry）
 * @property {string}                          [apiKey]        覆盖默认 API Key
 * @property {string}                          [provider]      'deepseek' | 'kimi' | 'qwen' | 'doubao'
 * @property {string}                          [mode]          'chat' | 'reasoner'
 * @property {string}                          [subModel]      子模型名
 * @property {boolean}                         [useTools]      是否启用工具，默认 true
 * @property {AbortSignal}                     [abortSignal]   中断信号
 */

/**
 * @typedef {object} ChatTrace
 * @property {string}   traceId
 * @property {string}   [sessionId]
 * @property {number}   startedAt
 * @property {number}   [finishedAt]
 * @property {object[]} events
 */

/**
 * @typedef {object} ChatResult
 * @property {string}              content      最终文本回复
 * @property {ChatToolCall[]}      [toolCalls]  本轮触发的工具调用
 * @property {boolean}             [stopped]    是否被用户/超时打断
 * @property {object}              [usage]      token 用量（如有）
 * @property {ChatTrace}           [trace]      执行轨迹（含 LLM 调用与工具执行记录）
 */

/**
 * @typedef {object} ChatMessage
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {string}  content
 * @property {string}  [tool_call_id]
 * @property {object[]} [tool_calls]
 */

/**
 * IChatProvider —— 任何「有状态对话能力」的统一接口
 *
 * 实现方契约：
 *   1. chat(userContent, options) 必返回 Promise<ChatResult>
 *   2. chat 内部应维护对话历史（messages），调用方不直接传 messages 数组
 *   3. 流式输出通过 options.onChunk 回调，不用 return value 携带流
 *   4. 工具调用、确认管理对消费方透明 —— 由 provider 自己处理
 *   5. 同一实例多次 chat() 必须共享上下文（多轮）
 *
 * 当前实现：
 *   - chat-core: createChatSession({ workspace, registry })  → IChatProvider
 *   - agent:     createAgent({ workspace, ... })            → IChatProvider（计划中）
 *
 * @typedef {object} IChatProvider
 * @property {string}             id
 * @property {ChatMessage[]}      messages
 * @property {(content: string, options?: ChatOptions) => Promise<ChatResult>} chat
 * @property {() => void}         clear
 * @property {() => Promise<{success:boolean,error?:string}>}  [save]
 * @property {() => Promise<{success:boolean,error?:string,data?:object}>} [load]
 */

/**
 * IChatProviderFactory —— 创建 IChatProvider 实例的工厂签名
 *
 * @typedef {(opts: object) => IChatProvider} IChatProviderFactory
 *
 * @example
 *   import { createChatSession } from '@xingseq/chat-core'
 *   const provider = createChatSession({ workspace, registry })
 *   const reply = await provider.chat('你好')
 *
 *   // 后续可无缝替换为 agent，应用层零改动：
 *   // import { createAgent } from '@xingseq/agent'
 *   // const provider = createAgent({ workspace })
 */

// 标记导出：让 import 它的代码能感知到这是契约文件
export const IChatProviderContract = Object.freeze({
  version: '1.0.0',
  description: '星序对话能力统一接口契约',
  implementations: {
    'chat-core': 'createChatSession',
    'agent': 'createAgent (planned)'
  }
})
