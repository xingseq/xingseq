#!/usr/bin/env node
/**
 * chat-core trace 收集单元测试
 *
 * 验证 runChatTurnWithTools 返回的 trace 是否正确记录：
 *   - LLM 请求 / 响应
 *   - 工具执行成功 / 失败
 *   - 工具被拒绝
 *   - 最大深度错误
 *
 * 运行：node packages/chat-core/test/trace.test.mjs
 */

import { runChatTurnWithTools, TRACE_EVENT_TYPES } from '@xingseq/chat-core'

let passed = 0
let failed = 0

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`)
    passed++
  } else {
    console.error(`  ✗ ${msg}`)
    failed++
  }
}

function assertEqual(actual, expected, msg) {
  assert(actual === expected, `${msg} (期望 ${expected}, 实际 ${actual})`)
}

console.log('\n[chat-core trace test]\n')

// ===== 用例 1：无工具调用，直接返回最终回复 =====
{
  console.log('1. 无工具调用时 trace 只含请求/响应/最终事件')
  const messages = [{ role: 'user', content: '你好' }]
  const result = await runChatTurnWithTools({
    apiKey: 'mock',
    messages,
    executor: () => Promise.resolve({
      success: true,
      fullContent: '你好，有什么可以帮忙？',
      toolCalls: [],
      model: 'mock'
    })
  })

  assert(result.success, '请求成功')
  assert(Array.isArray(result.trace?.events), '返回 trace.events')
  const types = result.trace.events.map(e => e.type)
  assertEqual(types[0], TRACE_EVENT_TYPES.LLM_REQUEST, '第一个事件是 llm-request')
  assertEqual(types[1], TRACE_EVENT_TYPES.LLM_RESPONSE, '第二个事件是 llm-response')
  assertEqual(types[2], TRACE_EVENT_TYPES.FINAL, '第三个事件是 final')
  assertEqual(result.trace.events[0].payload.messageCount, 1, 'llm-request 记录消息数量')
  assertEqual(result.trace.events[0].payload.lastMessage.content, '你好', 'llm-request 记录最后一条消息')
  assertEqual(result.trace.events[1].payload.content, '你好，有什么可以帮忙？', 'llm-response 记录最终内容')
}

// ===== 用例 2：一轮工具调用后得到最终回复 =====
{
  console.log('\n2. 一轮工具调用后 trace 记录完整循环')
  const messages = [{ role: 'user', content: '现在几点' }]
  let turn = 0
  const result = await runChatTurnWithTools({
    apiKey: 'mock',
    messages,
    registry: {
      dispatch: async (tc) => {
        assertEqual(tc.function.name, 'get_time', 'dispatch 收到 get_time')
        return { time: '12:00' }
      }
    },
    executor: () => {
      if (turn === 0) {
        turn++
        return Promise.resolve({
          success: true,
          fullContent: '我来查一下时间。',
          toolCalls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'get_time', arguments: '{}' }
          }],
          model: 'mock'
        })
      }
      return Promise.resolve({
        success: true,
        fullContent: '现在是 12:00。',
        toolCalls: [],
        model: 'mock'
      })
    }
  })

  assert(result.success, '请求成功')
  const types = result.trace.events.map(e => e.type)
  assert(types.filter(t => t === TRACE_EVENT_TYPES.LLM_REQUEST).length === 2, '两次 LLM 请求')
  assert(types.filter(t => t === TRACE_EVENT_TYPES.LLM_RESPONSE).length === 2, '两次 LLM 响应')
  assert(types.filter(t => t === TRACE_EVENT_TYPES.TOOL_EXECUTION).length === 1, '一次工具执行')
  assertEqual(types[types.length - 1], TRACE_EVENT_TYPES.FINAL, '最后事件是 final')

  const toolEvent = result.trace.events.find(e => e.type === TRACE_EVENT_TYPES.TOOL_EXECUTION)
  assert(toolEvent.payload.result.time === '12:00', '工具执行结果正确')
  assert(typeof toolEvent.payload.duration === 'number', '工具执行记录耗时')
}

// ===== 用例 3：工具执行失败 =====
{
  console.log('\n3. 工具执行失败时 trace 记录错误')
  const messages = [{ role: 'user', content: '读文件' }]
  let turn = 0
  const result = await runChatTurnWithTools({
    apiKey: 'mock',
    messages,
    registry: {
      dispatch: async () => {
        throw new Error('文件不存在')
      }
    },
    executor: () => {
      if (turn === 0) {
        turn++
        return Promise.resolve({
          success: true,
          fullContent: '我来读。',
          toolCalls: [{
            id: 'call-2',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"x.txt"}' }
          }],
          model: 'mock'
        })
      }
      return Promise.resolve({
        success: true,
        fullContent: '读取失败了。',
        toolCalls: [],
        model: 'mock'
      })
    }
  })

  assert(result.success, '请求成功（工具失败不中断）')
  const toolEvent = result.trace.events.find(e => e.type === TRACE_EVENT_TYPES.TOOL_EXECUTION)
  assert(toolEvent.payload.error === '文件不存在', 'trace 记录工具错误')
  assert(toolEvent.payload.result === null, '失败时 result 为 null')
}

// ===== 用例 4：工具被拒绝 =====
{
  console.log('\n4. 工具被拒绝时 trace 记录 tool-denied')
  const messages = [{ role: 'user', content: '执行命令' }]
  let turn = 0
  const result = await runChatTurnWithTools({
    apiKey: 'mock',
    messages,
    registry: {
      dispatch: async () => 'never called'
    },
    confirmation: {
      confirmToolExecution: async () => false
    },
    executor: () => {
      if (turn === 0) {
        turn++
        return Promise.resolve({
          success: true,
          fullContent: '我准备执行命令。',
          toolCalls: [{
            id: 'call-3',
            type: 'function',
            function: { name: 'execute_command', arguments: '{"command":"ls"}' }
          }],
          model: 'mock'
        })
      }
      return Promise.resolve({
        success: true,
        fullContent: '命令已被用户拒绝，不再执行。',
        toolCalls: [],
        model: 'mock'
      })
    }
  })

  assert(result.success, '请求成功')
  const deniedEvent = result.trace.events.find(e => e.type === TRACE_EVENT_TYPES.TOOL_DENIED)
  assert(deniedEvent, '存在 tool-denied 事件')
  assertEqual(deniedEvent.payload.reason, '用户拒绝', '记录拒绝原因')
}

// ===== 用例 5：最大深度 =====
{
  console.log('\n5. 达到最大深度时 trace 记录 error')
  const messages = [{ role: 'user', content: '循环' }]
  const result = await runChatTurnWithTools({
    apiKey: 'mock',
    messages,
    maxDepth: 2,
    registry: {
      dispatch: async () => ({ ok: true })
    },
    executor: () => Promise.resolve({
      success: true,
      fullContent: '继续。',
      toolCalls: [{
        id: 'call-loop',
        type: 'function',
        function: { name: 'noop', arguments: '{}' }
      }],
      model: 'mock'
    })
  })

  assert(!result.success, '达到最大深度后失败')
  assertEqual(result.depth, 2, 'depth 等于 maxDepth')
  const errorEvent = result.trace.events.find(e => e.type === TRACE_EVENT_TYPES.ERROR)
  assert(errorEvent, '存在 error 事件')
  assertEqual(errorEvent.payload.error.code, 'MAX_DEPTH', '错误码为 MAX_DEPTH')
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`)
process.exit(failed > 0 ? 1 : 0)
