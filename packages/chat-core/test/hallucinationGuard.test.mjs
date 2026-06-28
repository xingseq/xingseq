/**
 * 防 LLM 幻觉智能单元测试（LLM 审查版）
 *
 * 验证 checkToolHallucination 的 LLM 审查逻辑：
 *   - guardExecutor 返回 hallucination: true → 检测到幻觉
 *   - guardExecutor 返回 hallucination: false → 放行
 *   - guardExecutor 调用失败 → 保守放行
 *   - chatLoop 集成：guardExecutor 触发纠正重试
 *
 * 运行：node packages/chat-core/test/hallucinationGuard.test.mjs
 */

import assert from 'node:assert/strict'
import { checkToolHallucination, HALLUCINATION_GUARD_DEFAULTS, GUARD_SYSTEM_PROMPT } from '@xingseq/chat-core'
import { runChatTurnWithTools } from '@xingseq/chat-core'

console.log('\n[hallucinationGuard test - LLM 审查版]\n')

// ===== 用例 1：guardExecutor 判定为幻觉 =====
{
  console.log('1. guardExecutor 判定为幻觉')
  const guardExecutor = async () => ({
    success: true,
    fullContent: '{"hallucination": true}'
  })
  const result = await checkToolHallucination({
    content: '我已经调用了 read_file 工具，结果如下...',
    guardExecutor,
    availableTools: ['read_file', 'list_dir']
  })
  assert(result.detected === true, '应检测到幻觉')
  assert(typeof result.correction === 'string', '应返回纠正消息')
  console.log('  ✓ PASS\n')
}

// ===== 用例 2：guardExecutor 判定为非幻觉 =====
{
  console.log('2. guardExecutor 判定为非幻觉')
  const guardExecutor = async () => ({
    success: true,
    fullContent: '{"hallucination": false}'
  })
  const result = await checkToolHallucination({
    content: '你好，有什么可以帮助你的？',
    guardExecutor,
    availableTools: ['read_file']
  })
  assert(result.detected === false, '不应检测到幻觉')
  console.log('  ✓ PASS\n')
}

// ===== 用例 3：guardExecutor 调用失败 → 保守放行 =====
{
  console.log('3. guardExecutor 调用失败 → 保守放行')
  const guardExecutor = async () => ({
    success: false,
    error: '网络超时'
  })
  const result = await checkToolHallucination({
    content: '我已经执行了 web_search',
    guardExecutor,
    availableTools: ['web_search']
  })
  assert(result.detected === false, '失败时应保守放行')
  console.log('  ✓ PASS\n')
}

// ===== 用例 4：guardExecutor 抛异常 → 保守放行 =====
{
  console.log('4. guardExecutor 抛异常 → 保守放行')
  const guardExecutor = async () => { throw new Error('connection refused') }
  const result = await checkToolHallucination({
    content: '已调用 send_email 发送了邮件',
    guardExecutor,
    availableTools: ['send_email']
  })
  assert(result.detected === false, '异常时应保守放行')
  console.log('  ✓ PASS\n')
}

// ===== 用例 5：无 content → 不检测 =====
{
  console.log('5. 无 content → 不检测')
  const guardExecutor = async () => ({ success: true, fullContent: '{"hallucination": true}' })
  const result = await checkToolHallucination({
    content: '',
    guardExecutor,
    availableTools: ['read_file']
  })
  assert(result.detected === false, '空 content 应直接放行')
  console.log('  ✓ PASS\n')
}

// ===== 用例 6：无 guardExecutor → 不检测 =====
{
  console.log('6. 无 guardExecutor → 不检测')
  const result = await checkToolHallucination({
    content: '我已经调用了 read_file',
    guardExecutor: null,
    availableTools: ['read_file']
  })
  assert(result.detected === false, '无 guardExecutor 应直接放行')
  console.log('  ✓ PASS\n')
}

// ===== 用例 7：guardExecutor 返回非标准 JSON 但包含判断 =====
{
  console.log('7. guardExecutor 返回非标准 JSON（包含分析文本+JSON）')
  const guardExecutor = async () => ({
    success: true,
    fullContent: '分析：该回复声称已调用工具。\n\n{"hallucination": true}'
  })
  const result = await checkToolHallucination({
    content: '我已经使用 web_fetch 获取了网页内容',
    guardExecutor,
    availableTools: ['web_fetch']
  })
  assert(result.detected === true, '应能从混合文本中提取判断')
  console.log('  ✓ PASS\n')
}

// ===== 用例 8：GUARD_SYSTEM_PROMPT 存在且为字符串 =====
{
  console.log('8. GUARD_SYSTEM_PROMPT 已导出')
  assert(typeof GUARD_SYSTEM_PROMPT === 'string', 'GUARD_SYSTEM_PROMPT 应为字符串')
  assert(GUARD_SYSTEM_PROMPT.includes('工具调用审查员'), '应包含角色设定')
  console.log('  ✓ PASS\n')
}

// ===== 用例 9：HALLUCINATION_GUARD_DEFAULTS 正确 =====
{
  console.log('9. HALLUCINATION_GUARD_DEFAULTS 正确')
  assert(HALLUCINATION_GUARD_DEFAULTS.enabled === true)
  assert(HALLUCINATION_GUARD_DEFAULTS.maxRetries === 2)
  console.log('  ✓ PASS\n')
}

// ===== 用例 10：chatLoop 集成 - guardExecutor 检测到幻觉后纠正重试 =====
{
  console.log('10. chatLoop 集成 - guardExecutor 触发纠正重试')
  let executorCalls = 0
  const executor = async ({ messages }) => {
    executorCalls++
    if (executorCalls === 1) {
      // 第一次：返回幻觉内容（无 toolCalls）
      return { success: true, fullContent: '我已经调用了 read_file，内容如下...', toolCalls: [] }
    }
    // 第二次（纠正后）：返回正常最终回复
    return { success: true, fullContent: '好的，让我帮你查看文件。需要你告诉我文件路径。', toolCalls: [] }
  }

  let guardCalls = 0
  const guardExecutor = async ({ messages }) => {
    guardCalls++
    if (guardCalls === 1) {
      // 第一次审查：判定幻觉
      return { success: true, fullContent: '{"hallucination": true}' }
    }
    // 第二次审查（纠正后的回复）：判定通过
    return { success: true, fullContent: '{"hallucination": false}' }
  }

  const result = await runChatTurnWithTools({
    apiKey: 'test-key',
    messages: [{ role: 'user', content: '帮我看看 config.json 的内容' }],
    tools: [{ type: 'function', function: { name: 'read_file', description: '读取文件' } }],
    executor,
    guardExecutor,
    hallucinationGuard: { enabled: true, maxRetries: 2 }
  })

  assert(result.success === true, '应成功')
  assert(executorCalls === 2, `主 executor 应被调用 2 次，实际 ${executorCalls}`)
  assert(guardCalls === 2, `guardExecutor 应被调用 2 次，实际 ${guardCalls}`)
  assert(result.fullContent.includes('让我帮你查看文件'), '最终回复应是纠正后的内容')
  // trace 中应有 hallucination-detected 事件
  const hEvent = result.trace.events.find(e => e.type === 'hallucination-detected')
  assert(hEvent, '应有 hallucination-detected trace 事件')
  assert(hEvent.payload.retryCount === 1, 'retryCount 应为 1')
  console.log('  ✓ PASS\n')
}

// ===== 用例 11：chatLoop - 无 guardExecutor 时不触发审查 =====
{
  console.log('11. chatLoop - 无 guardExecutor 时不触发审查（直接放行）')
  let executorCalls = 0
  const executor = async () => {
    executorCalls++
    return { success: true, fullContent: '我已经调用了 read_file 获取了内容', toolCalls: [] }
  }

  const result = await runChatTurnWithTools({
    apiKey: 'test-key',
    messages: [{ role: 'user', content: '看看文件' }],
    tools: [{ type: 'function', function: { name: 'read_file' } }],
    executor
    // 没有 guardExecutor
  })

  assert(result.success === true)
  assert(executorCalls === 1, '无 guardExecutor 应只调用一次 executor')
  console.log('  ✓ PASS\n')
}

// ===== 用例 12：chatLoop - hallucinationGuard 禁用时不触发审查 =====
{
  console.log('12. chatLoop - hallucinationGuard: false 时禁用审查')
  let guardCalls = 0
  const executor = async () => ({
    success: true, fullContent: '已调用 read_file 结果如下', toolCalls: []
  })
  const guardExecutor = async () => {
    guardCalls++
    return { success: true, fullContent: '{"hallucination": true}' }
  }

  await runChatTurnWithTools({
    apiKey: 'test-key',
    messages: [{ role: 'user', content: '看看文件' }],
    tools: [{ type: 'function', function: { name: 'read_file' } }],
    executor,
    guardExecutor,
    hallucinationGuard: false
  })

  assert(guardCalls === 0, '禁用时不应调用 guardExecutor')
  console.log('  ✓ PASS\n')
}

// ===== 用例 13：chatLoop - maxRetries 到达后停止重试 =====
{
  console.log('13. chatLoop - maxRetries 到达后停止重试放行')
  let executorCalls = 0
  const executor = async () => {
    executorCalls++
    return { success: true, fullContent: '我已调用了 search 工具', toolCalls: [] }
  }
  const guardExecutor = async () => ({
    success: true, fullContent: '{"hallucination": true}'
  })

  const result = await runChatTurnWithTools({
    apiKey: 'test-key',
    messages: [{ role: 'user', content: '搜索一下' }],
    tools: [{ type: 'function', function: { name: 'search' } }],
    executor,
    guardExecutor,
    hallucinationGuard: { enabled: true, maxRetries: 1 }
  })

  // maxRetries=1, 所以：第1次执行→审查判幻觉→第2次执行→审查达上限不再重试→放行
  assert(executorCalls === 2, `应调用 2 次 executor（1次初始+1次重试），实际 ${executorCalls}`)
  assert(result.success === true)
  console.log('  ✓ PASS\n')
}

// ===== 统计 =====
const totalTests = 13
console.log(`\n✅ All ${totalTests} tests passed.`)
