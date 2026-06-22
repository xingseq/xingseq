/**
 * @xingseq/llm-core smoke 测试
 *
 * 不发起真实 API 调用：
 *   - parseStream: mock async iterator
 *   - buildRequestParams / parseApiError / sessionManager: 纯函数 / 内存
 *   - executeChat: 用 mock client（monkey patch import 不便，直接用 client 工厂的可替换字段不行，因此 executeChat 端到端用 mock provider 不在本 smoke 范围）
 *
 * 客户端创建只验证不抛错（不实际发请求）
 */

import { strict as assert } from 'node:assert'
import { setSharedEnv } from '@xingseq/shared-utils/env'

// 注入 CLI 环境，避免 logger 默认走 Electron
setSharedEnv({
  isCLI: true,
  importers: {
    cliLogger: () => import('electron-log/node.js').catch(() => ({ default: console }))
  }
})

import {
  parseStream,
  buildRequestParams,
  addSystemPrompt,
  parseApiError,
  isRetryableWithFallback,
  createSessionController,
  abortSession,
  cleanupSession,
  createDeepSeekClient,
  createKimiClient,
  createQwenClient,
  createDoubaoClient,
  createClient,
  MODEL_MAP,
  KIMI_MODEL_MAP,
  QWEN_MODEL_MAP,
  DOUBAO_MODEL_MAP
} from '@xingseq/llm-core'
import { __resetForTest as resetSessions } from '@xingseq/llm-core/sessionManager'

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

// ===== parseStream =====

function makeStream(chunks) {
  return (async function* () {
    for (const c of chunks) yield c
  })()
}

test('parseStream: 普通内容 + finish_reason=stop', async () => {
  const captured = []
  const stream = makeStream([
    { choices: [{ delta: { content: 'Hel' }, finish_reason: null }] },
    { choices: [{ delta: { content: 'lo' },  finish_reason: null }] },
    { choices: [{ delta: {},                  finish_reason: 'stop' }] }
  ])
  const res = await parseStream(stream, ev => captured.push(ev))
  assert.equal(res.fullContent, 'Hello')
  assert.equal(res.hasReasoning, false)
  assert.equal(res.toolCalls.length, 0)
  assert.equal(res.fragments.length, 1)
  assert.equal(res.fragments[0].type, 'RESPONSE')
  // onChunk: 2 个增量 RESPONSE + 1 个 done RESPONSE
  assert.equal(captured.filter(e => e.type === 'RESPONSE').length, 3)
  assert.equal(captured[captured.length - 1].done, true)
})

test('parseStream: reasoning_content 流', async () => {
  const stream = makeStream([
    { choices: [{ delta: { reasoning_content: '思考A' }, finish_reason: null }] },
    { choices: [{ delta: { reasoning_content: '思考B' }, finish_reason: null }] },
    { choices: [{ delta: { content: '回答' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] }
  ])
  const res = await parseStream(stream, null)
  assert.equal(res.reasoning_content, '思考A思考B')
  assert.equal(res.hasReasoning, true)
  assert.equal(res.fullContent, '回答')
  assert.equal(res.fragments.length, 2)
  assert.equal(res.fragments[0].type, 'THINK')
  assert.equal(res.fragments[1].type, 'RESPONSE')
})

test('parseStream: tool_calls 流', async () => {
  const stream = makeStream([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"ci' } }] }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"BJ"}' } }] }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
  ])
  const res = await parseStream(stream, null)
  assert.equal(res.toolCalls.length, 1)
  assert.equal(res.toolCalls[0].id, 'call_1')
  assert.equal(res.toolCalls[0].function.name, 'get_weather')
  assert.equal(res.toolCalls[0].function.arguments, '{"city":"BJ"}')
})

// ===== buildRequestParams =====

test('buildRequestParams: deepseek chat 默认', () => {
  const { requestParams, model } = buildRequestParams({
    messages: [{ role: 'user', content: 'hi' }],
    mode: 'chat',
    customParams: null,
    provider: 'deepseek'
  })
  assert.equal(model, MODEL_MAP.chat)
  assert.equal(requestParams.model, MODEL_MAP.chat)
  assert.equal(requestParams.stream, true)
  assert.equal(requestParams.temperature, 1.0)
  assert.equal(requestParams.max_tokens, 8000)
  assert.equal(requestParams.tools, undefined)
})

test('buildRequestParams: subModel 优先级最高', () => {
  const { model } = buildRequestParams({
    messages: [{ role: 'user', content: 'x' }],
    mode: 'chat',
    customParams: null,
    provider: 'kimi',
    subModel: 'kimi-k2.5'
  })
  assert.equal(model, 'kimi-k2.5')
})

test('buildRequestParams: kimi reasoner -> k2-thinking + max_tokens 32768', () => {
  const { requestParams, model } = buildRequestParams({
    messages: [{ role: 'user', content: 'x' }],
    mode: 'reasoner',
    customParams: null,
    provider: 'kimi'
  })
  assert.equal(model, 'kimi-k2-thinking')
  assert.equal(requestParams.max_tokens, 32768)
})

test('buildRequestParams: qwen reasoner -> qwq-plus', () => {
  const { model } = buildRequestParams({
    messages: [{ role: 'user', content: 'x' }],
    mode: 'reasoner',
    customParams: null,
    provider: 'qwen'
  })
  assert.equal(model, 'qwq-plus')
})

test('buildRequestParams: doubao 端点直通 + 无 tool_choice', () => {
  const { requestParams, model } = buildRequestParams({
    messages: [{ role: 'user', content: 'x' }],
    mode: 'ep-test-001',
    customParams: null,
    provider: 'doubao',
    tools: [{ type: 'function', function: { name: 'foo', parameters: {} } }]
  })
  assert.equal(model, 'ep-test-001')
  assert.equal(requestParams.tools.length, 1)
  assert.equal(requestParams.tool_choice, undefined) // 豆包端点不加 tool_choice
})

test('buildRequestParams: tools 数组注入 + tool_choice=auto', () => {
  const { requestParams } = buildRequestParams({
    messages: [{ role: 'user', content: 'x' }],
    mode: 'chat',
    customParams: null,
    provider: 'deepseek',
    tools: [
      { type: 'function', function: { name: 'a', parameters: {} } },
      { type: 'function', function: { name: 'b', parameters: {} } }
    ]
  })
  assert.equal(requestParams.tools.length, 2)
  assert.equal(requestParams.tool_choice, 'auto')
})

test('buildRequestParams: customParams temperature/stream', () => {
  const { requestParams } = buildRequestParams({
    messages: [{ role: 'user', content: 'x' }],
    mode: 'chat',
    customParams: { temperature: 0.2, stream: false },
    provider: 'deepseek'
  })
  assert.equal(requestParams.temperature, 0.2)
  assert.equal(requestParams.stream, false)
})

// ===== addSystemPrompt =====

test('addSystemPrompt: 注入到开头', () => {
  const msgs = addSystemPrompt(
    [{ role: 'user', content: 'hi' }],
    'chat',
    { systemPrompt: 'You are helpful' }
  )
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].role, 'system')
  assert.equal(msgs[0].content, 'You are helpful')
})

test('addSystemPrompt: 无 systemPrompt 不变', () => {
  const original = [{ role: 'user', content: 'hi' }]
  const msgs = addSystemPrompt(original, 'chat', null)
  assert.equal(msgs, original)
})

// ===== parseApiError =====

test('parseApiError: AbortError -> ABORTED', () => {
  const e = new Error('aborted'); e.name = 'AbortError'
  const r = parseApiError(e, 'deepseek')
  assert.equal(r.code, 'ABORTED')
  assert.equal(r.level, 'info')
})

test('parseApiError: deepseek 402 -> INSUFFICIENT_BALANCE', () => {
  const e = new Error('insufficient'); e.status = 402
  const r = parseApiError(e, 'deepseek')
  assert.equal(r.code, 'INSUFFICIENT_BALANCE')
})

test('parseApiError: kimi 401 -> AUTH_FAILED', () => {
  const e = new Error('Unauthorized'); e.status = 401
  const r = parseApiError(e, 'kimi')
  assert.equal(r.code, 'AUTH_FAILED')
})

test('parseApiError: qwen 429 -> RATE_LIMIT', () => {
  const e = new Error('rate_limit'); e.status = 429
  const r = parseApiError(e, 'qwen')
  assert.equal(r.code, 'RATE_LIMIT')
})

test('parseApiError: doubao 500 -> SERVER_ERROR', () => {
  const e = new Error('boom'); e.status = 500
  const r = parseApiError(e, 'doubao')
  assert.equal(r.code, 'SERVER_ERROR')
})

test('parseApiError: 未知 provider 走 default + 402 兜底', () => {
  const e = new Error('???'); e.status = 402
  const r = parseApiError(e, 'unknown-provider-xyz')
  assert.equal(r.code, 'INSUFFICIENT_BALANCE')
})

test('isRetryableWithFallback: AUTH_FAILED 不重试', () => {
  const e = new Error('Unauthorized'); e.status = 401
  assert.equal(isRetryableWithFallback(e, 'deepseek'), false)
})

test('isRetryableWithFallback: SERVER_ERROR 可重试', () => {
  const e = new Error('boom'); e.status = 500
  assert.equal(isRetryableWithFallback(e, 'deepseek'), true)
})

// ===== sessionManager =====

test('sessionManager: create -> abort 成功', () => {
  resetSessions()
  const ctl = createSessionController('s1')
  assert.equal(ctl.signal.aborted, false)
  const ok = abortSession('s1')
  assert.equal(ok, true)
  assert.equal(ctl.signal.aborted, true)
})

test('sessionManager: abort 不存在的 sessionId 返回 false', () => {
  resetSessions()
  assert.equal(abortSession('not-exist'), false)
})

test('sessionManager: cleanupSession 不抛错', () => {
  resetSessions()
  createSessionController('s2')
  cleanupSession('s2')
  // 已 cleanup，再次 abort 应返回 false
  assert.equal(abortSession('s2'), false)
})

// ===== clients =====

test('clients: 4 个 provider 客户端创建不抛错', () => {
  const a = createDeepSeekClient('sk-test')
  const b = createKimiClient('sk-test')
  const c = createQwenClient('sk-test')
  const d = createDoubaoClient('sk-test')
  for (const cli of [a, b, c, d]) {
    assert.ok(cli && typeof cli.chat?.completions?.create === 'function')
  }
})

test('clients: createClient 按 provider 分发', () => {
  const cli = createClient('qwen', 'sk-test')
  assert.ok(cli && typeof cli.chat?.completions?.create === 'function')
})

test('clients: 模型映射表完整性', () => {
  assert.ok(MODEL_MAP.chat && MODEL_MAP.reasoner)
  assert.ok(KIMI_MODEL_MAP['kimi-k2-thinking'])
  assert.ok(QWEN_MODEL_MAP['qwq-plus'])
  assert.ok(DOUBAO_MODEL_MAP['doubao-1.5-pro-256k'])
})

// ===== executeChat（用注入式 mock 验证流水线，跳过真实 OpenAI 调用） =====
// executeChat 内部 new OpenAI()，无法替换；这里只测错误兜底分支
import { executeChat } from '@xingseq/llm-core/executeChat'

test('executeChat: apiKey 为空 -> success=false', async () => {
  const r = await executeChat({ apiKey: '', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(r.success, false)
  assert.equal(r.error.code, 'AUTH_FAILED')
})

test('executeChat: messages 为空 -> success=false', async () => {
  const r = await executeChat({ apiKey: 'sk-x', messages: [] })
  assert.equal(r.success, false)
  assert.equal(r.error.code, 'BAD_REQUEST')
})

// ===== 跑测试 =====

let pass = 0, fail = 0
for (const t of tests) {
  try {
    await t.fn()
    pass++
    console.log('  ✓', t.name)
  } catch (e) {
    fail++
    console.error('  ✗', t.name)
    console.error('    ', e.message)
  }
}
console.log(`\n${pass}/${tests.length} passed${fail ? `, ${fail} failed` : ''}`)
if (fail) process.exit(1)
