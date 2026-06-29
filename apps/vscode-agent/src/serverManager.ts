import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { spawn, ChildProcess } from 'child_process'
import http from 'http'

export class ServerManager {
  private proc: ChildProcess | null = null
  private port = 3002

  constructor(private context: vscode.ExtensionContext) {}

  /** 查找 workspace-app/src/server.mjs */
  private resolveServerPath(): string {
    const config = vscode.workspace.getConfiguration('xingseq')
    const configured = config.get<string>('serverPath', '')
    if (configured && fs.existsSync(configured)) return configured

    // 自动查找：当前工作区向上找 apps/workspace-app
    const wsFolders = vscode.workspace.workspaceFolders
    if (wsFolders) {
      for (const folder of wsFolders) {
        const candidate = path.join(folder.uri.fsPath, 'apps', 'workspace-app', 'src', 'server.mjs')
        if (fs.existsSync(candidate)) return candidate
      }
    }

    // 查找 monorepo 根
    if (wsFolders) {
      for (const folder of wsFolders) {
        const candidate = path.join(folder.uri.fsPath, 'src', 'server.mjs')
        if (fs.existsSync(candidate)) return candidate
      }
    }

    throw new Error('未找到 workspace-app/src/server.mjs，请在设置中配置 xingseq.serverPath')
  }

  async start(port: number): Promise<void> {
    if (this.proc && !this.proc.killed) {
      vscode.window.showInformationMessage('XingSeq server 已在运行')
      return
    }

    this.port = port
    const serverPath = this.resolveServerPath()
    const serverDir = path.dirname(path.dirname(serverPath)) // apps/workspace-app

    // 以子进程启动 server
    this.proc = spawn(process.execPath, [serverPath], {
      cwd: serverDir,
      env: {
        ...process.env,
        PORT: String(port),
        WORKSPACE_APP_PATH: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.proc.stdout?.on('data', (data) => {
      const text = data.toString()
      console.log('[xingseq-server]', text.trim())
    })

    this.proc.stderr?.on('data', (data) => {
      console.error('[xingseq-server]', data.toString().trim())
    })

    this.proc.on('exit', (code) => {
      console.log(`[xingseq-server] exited with code ${code}`)
      this.proc = null
    })

    // 等待 server 就绪
    await this.waitForReady(port, 15000)
    vscode.window.showInformationMessage(`XingSeq server started on :${port}`)
  }

  /** 轮询 /api/health 直到 server 就绪 */
  private waitForReady(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now()
    return new Promise((resolve, reject) => {
      const check = () => {
        const req = http.get(`http://localhost:${port}/api/health`, (res) => {
          if (res.statusCode === 200) { resolve(); return }
          retry()
        })
        req.on('error', retry)
        req.setTimeout(2000, () => { req.destroy(); retry() })
      }
      const retry = () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('XingSeq server start timeout'))
          return
        }
        setTimeout(check, 500)
      }
      check()
    })
  }

  stop(): void {
    if (this.proc) {
      this.proc.kill('SIGTERM')
      this.proc = null
      vscode.window.showInformationMessage('XingSeq server stopped')
    }
  }

  getPort(): number { return this.port }
  isRunning(): boolean { return this.proc !== null && !this.proc.killed }
}
