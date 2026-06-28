/**
 * hallucinationGuard - 防 LLM 工具调用幻觉智能单元
 *
 * 问题场景：
 *   LLM 在 content 中声称已调用某工具或虚构工具返回结果，
 *   但实际并未产生 tool_calls 结构。
 *
 * 解决方式：
 *   使用独立的审查 LLM（guardExecutor）判断执行 LLM 的回复是否存在工具幻觉。
 *   审查 LLM 与执行 LLM 分离，产出者不应自审。
 *
 * 设计原则：
 *   - LLM 判断：交给 LLM 做语义理解，不依赖脆弱的正则匹配
 *   - 分离审查：guardExecutor 独立于主 executor
 *   - 简单直接：一次 LLM 调用，YES/NO 判断
 */

/**
 * 审查 prompt：让审查 LLM 判断回复是否存在工具调用幻觉
 */
const GUARD_SYSTEM_PROMPT = `你是一个工具调用审查员。你的唯一任务是判断一段 AI 回复是否存在"工具调用幻觉"。

工具调用幻觉的定义：AI 在回复中声称已经执行了某个工具、或引用了工具返回的结果，但实际上并没有通过 function calling 真正调用该工具。

判断标准：
- 如果回复中声称"已调用"、"已执行"、"结果显示"、"返回了"等完成态描述，且涉及工具操作，则判定为幻觉
- 如果回复只是讨论、建议、或表达意图（"我可以调用"、"让我来"、"需要使用"），则不是幻觉
- 如果回复不涉及任何工具相关内容，则不是幻觉

你只需回复一个 JSON：
{"hallucination": true} 或 {"hallucination": false}`

/**
 * 使用审查 LLM 检测工具调用幻觉
 *
 * @param {object} opts
 * @param {string}   opts.content        - LLM 回复文本（待审查）
 * @param {function} opts.guardExecutor   - 审查用 LLM 执行器，签名同 executeChat
 * @param {string[]} [opts.availableTools] - 当前可用工具名列表（提供给审查 LLM 参考）
 * @returns {Promise<{ detected: boolean, correction?: string }>}
 */
export async function checkToolHallucination(opts) {
  const { content, guardExecutor, availableTools = [] } = opts

  if (!content || !guardExecutor) {
    return { detected: false }
  }

  const userPrompt = [
    '以下是 AI 的回复内容，请判断是否存在工具调用幻觉：',
    '',
    '---',
    content,
    '---',
    '',
    availableTools.length > 0
      ? `当前注册的可用工具：${availableTools.join(', ')}`
      : '（未提供工具列表）'
  ].join('\n')

  try {
    const result = await guardExecutor({
      messages: [
        { role: 'system', content: GUARD_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]
    })

    if (!result?.success || !result.fullContent) {
      // 审查 LLM 调用失败时，保守放行
      return { detected: false }
    }

    const detected = parseGuardResponse(result.fullContent)

    if (detected) {
      return { detected: true, correction: buildCorrectionMessage() }
    }

    return { detected: false }
  } catch {
    // 异常时保守放行
    return { detected: false }
  }
}

/**
 * 解析审查 LLM 的回复，提取 hallucination 判断
 * @param {string} response
 * @returns {boolean}
 */
function parseGuardResponse(response) {
  try {
    // 尝试直接解析 JSON
    const json = JSON.parse(response.trim())
    return json.hallucination === true
  } catch {
    // 如果不是标准 JSON，尝试从文本中提取
    const match = response.match(/"hallucination"\s*:\s*(true|false)/)
    if (match) {
      return match[1] === 'true'
    }
    // 兜底：包含明确的 true 标识
    if (response.toLowerCase().includes('hallucination": true') ||
        response.toLowerCase().includes('hallucination":true')) {
      return true
    }
    return false
  }
}

/**
 * 构建纠正消息（注入到对话中让执行 LLM 重新推理）
 * @returns {string}
 */
function buildCorrectionMessage() {
  return [
    '[系统校验] 你的回复被判定为存在工具调用幻觉——你声称已执行了工具操作，但实际并未产生任何 tool_calls。',
    '',
    '请重新推理：',
    '- 如果确实需要调用工具来完成任务，请正确使用 function calling 产生 tool_calls。',
    '- 如果不需要工具就能回答，请基于你已知的信息直接回复，不要虚构工具执行结果。'
  ].join('\n')
}

/**
 * 默认配置
 */
export const HALLUCINATION_GUARD_DEFAULTS = Object.freeze({
  enabled: true,
  maxRetries: 2  // 检测到幻觉后最多重试几次
})

// 导出供测试用
export { GUARD_SYSTEM_PROMPT }
