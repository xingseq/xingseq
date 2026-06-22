/**
 * 流式响应解析模块 - 解析 AI 流式响应（OpenAI SDK 兼容协议）
 *
 * 迁入自 electron/ai/streamParser.js（与 develop 完全一致，无外部依赖）
 */

/**
 * 处理流式响应
 * @param {AsyncIterator} stream - 流式响应迭代器
 * @param {function} onChunk - 数据块回调
 * @returns {Promise<object>} 解析结果 {fullContent, reasoning_content, hasReasoning, toolCalls, fragments}
 */
export async function parseStream(stream, onChunk) {
  let fullContent = ''
  let reasoning_content = ''
  const fragments = []
  let hasReasoning = false
  let toolCalls = []

  // 处理流式响应
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta

    if (!delta) continue

    // 处理思考过程 (reasoning_content)
    if (delta.reasoning_content) {
      reasoning_content += delta.reasoning_content
      hasReasoning = true

      if (onChunk) {
        onChunk({
          type: 'THINK',
          content: delta.reasoning_content,
          done: false
        })
      }
    }

    // 处理工具调用
    if (delta.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const index = toolCallDelta.index

        if (!toolCalls[index]) {
          toolCalls[index] = {
            id: toolCallDelta.id || '',
            type: 'function',
            function: {
              name: toolCallDelta.function?.name || '',
              arguments: ''
            }
          }
        }

        if (toolCallDelta.function?.name) {
          toolCalls[index].function.name = toolCallDelta.function.name
        }

        if (toolCallDelta.function?.arguments) {
          toolCalls[index].function.arguments += toolCallDelta.function.arguments
        }
      }
    }

    // 处理正常回复内容
    if (delta.content) {
      fullContent += delta.content

      if (onChunk) {
        onChunk({
          type: 'RESPONSE',
          content: delta.content,
          done: false
        })
      }
    }

    // 检查是否完成
    const finishReason = chunk.choices[0]?.finish_reason
    if (finishReason === 'stop') {
      if (hasReasoning && onChunk) {
        onChunk({
          type: 'THINK',
          content: '',
          done: true
        })
      }

      if (onChunk) {
        onChunk({
          type: 'RESPONSE',
          content: '',
          done: true
        })
      }
    } else if (finishReason === 'tool_calls') {
      if (hasReasoning && onChunk) {
        onChunk({
          type: 'THINK',
          content: '',
          done: true
        })
      }

      if (onChunk) {
        onChunk({
          type: 'TOOL_CALL',
          tool_calls: toolCalls.filter(tc => tc),
          done: true
        })
      }
    }
  }

  // 构建返回的 fragments
  if (hasReasoning && reasoning_content) {
    fragments.push({
      type: 'THINK',
      content: reasoning_content
    })
  }

  if (fullContent) {
    fragments.push({
      type: 'RESPONSE',
      content: fullContent
    })
  }

  return {
    fullContent,
    reasoning_content,
    hasReasoning,
    toolCalls: toolCalls.filter(tc => tc),
    fragments
  }
}
