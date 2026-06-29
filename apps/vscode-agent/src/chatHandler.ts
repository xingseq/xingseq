import * as vscode from 'vscode'
import { AgentClient } from './agentClient.js'

export function createChatHandler(client: AgentClient) {
  // 每个聊天会话维护一个 conversationId
  const sessionMap = new Map<string, string>() // chatSessionId -> conversationId

  return async function handleChat(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {

    // 1. 获取或创建 conversationId
    // VS Code Chat API 不提供 sessionId，使用 workspace 路径作为会话 key
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const sessionKey = wsPath || 'default'
    let conversationId = sessionMap.get(sessionKey)
    if (!conversationId) {
      const result = await client.newConversation(wsPath)
      conversationId = result.id
      sessionMap.set(sessionKey, conversationId)
    }

    // 2. 构造用户消息（附加命令上下文）
    let message = request.prompt
    if (request.command === 'fix') {
      message = `修复以下代码中的错误：\n\n${message}`
    } else if (request.command === 'explain') {
      message = `解释以下代码：\n\n${message}`
    } else if (request.command === 'test') {
      message = `为以下代码生成单元测试：\n\n${message}`
    }

    // 3. 附加当前打开的文件作为上下文
    const editor = vscode.window.activeTextEditor
    if (editor) {
      const fileName = vscode.workspace.asRelativePath(editor.document.uri)
      const selection = editor.selection
      const code = selection.isEmpty
        ? editor.document.getText()
        : editor.document.getText(selection)
      message = `[当前文件: ${fileName}]\n\`\`\`\n${code}\n\`\`\`\n\n${message}`
    }

    // 4. 调用 xingseq server（SSE 流式）
    const abortController = new AbortController()
    token.onCancellationRequested(() => abortController.abort())

    try {
      await client.chat({
        conversationId,
        workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        message,
        signal: abortController.signal,
        onEvent: ({ event, data }) => {
          switch (event) {
            case 'chunk':
              // 流式输出文本
              if (data.type === 'RESPONSE' || data.type === 'CONTENT') {
                stream.markdown(data.content || '')
              }
              if (data.type === 'THINK') {
                // 思考过程可用 stream.markdown 输出到折叠区域
                // 或用 stream.push() 创建 ChatResponseMarkdownPart
              }
              break

            case 'tool_call':
              // 工具调用通知
              stream.progress(`⚙ ${data.name}…`)
              break

            case 'tool_result':
              // 工具结果（可选展示）
              if (data.error) {
                stream.markdown(`\n> ⚠ **${data.name}** 失败: ${data.error}\n`)
              }
              break

            case 'tool_denied':
              stream.markdown(`\n> ⊘ **${data.name}** 已拒绝\n`)
              break

            case 'confirm_request':
              // 工具确认弹窗
              showConfirmDialog(client, data, stream)
              break

            case 'done':
              // 对话完成
              break

            case 'error':
              stream.markdown(`\n\n❌ 错误: ${data.message}\n`)
              break
          }
        }
      })
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        stream.markdown(`\n\n❌ 请求失败: ${err.message}\n`)
      }
    }
  }
}

/** 确认弹窗：用 VS Code 原生 API 替代浏览器弹窗 */
async function showConfirmDialog(
  client: AgentClient,
  data: { confirmId: string; toolName: string; args: any; countdown?: number },
  stream: vscode.ChatResponseStream
) {
  const countdownText = data.countdown
    ? `（${data.countdown}秒后自动执行）`
    : ''

  const choice = await vscode.window.showInformationMessage(
    `星序引擎请求执行: ${data.toolName} ${countdownText}`,
    { modal: true },
    '允许',
    '拒绝'
  )

  await client.confirm(data.confirmId, choice === '允许')
}
