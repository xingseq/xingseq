import * as vscode from 'vscode'
import { ServerManager } from './serverManager.js'
import { AgentClient } from './agentClient.js'
import { createChatHandler } from './chatHandler.js'

export async function activate(context: vscode.ExtensionContext) {
  // 1. 创建 server 管理器（自动拉起 workspace-app server）
  const serverMgr = new ServerManager(context)
  // 2. 创建 agent 客户端（HTTP+SSE 通信）
  const client = new AgentClient(() => serverMgr.getPort())

  // 3. 启动 server
  const port = vscode.workspace.getConfiguration('xingseq').get('serverPort', 3002)
  await serverMgr.start(port)

  // 4. 注册 Chat Participant
  const handler = createChatHandler(client)
  const participant = vscode.chat.createChatParticipant('xingseq.agent', handler)
  participant.iconPath = new vscode.ThemeIcon('sparkle')

  // 5. 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('xingseq.startServer', () => serverMgr.start(port)),
    vscode.commands.registerCommand('xingseq.stopServer', () => serverMgr.stop()),
    participant
  )

  // 6. 清理
  context.subscriptions.push({
    dispose: () => serverMgr.stop()
  })
}

export function deactivate() {}
