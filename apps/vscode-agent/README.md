# @xingseq/vscode-agent

VS Code 扩展，通过 Chat Participant 将星序引擎（XingSeq）接入 VS Code Chat 面板。

## 职责

- 以子进程启动 `workspace-app/src/server.mjs`
- 注册 `@xingseq` Chat Participant
- 通过 HTTP + SSE 与 workspace-app server 通信
- 在 Chat 面板中展示流式回复、工具调用状态和确认弹窗

## 主要模块

| 文件 | 说明 |
|------|------|
| `src/extension.ts` | 扩展入口，注册 Chat Participant 和命令 |
| `src/serverManager.ts` | 查找并管理 workspace-app server 子进程 |
| `src/agentClient.ts` | HTTP + SSE 客户端，调用 server API |
| `src/chatHandler.ts` | Chat Participant 消息处理 |
| `src/types.ts` | 类型定义 |
| `esbuild.mjs` | esbuild 打包脚本 |

## 使用方式

### 1. 安装依赖

```bash
cd apps/vscode-agent
npm install
```

### 2. 构建

```bash
npm run build
```

### 3. 调试

在 VS Code 中按 `F5`，会启动 Extension Development Host。在新窗口中：

1. 打开任意项目文件夹
2. 打开 Chat 面板（`Ctrl+Cmd+I` 或侧边栏聊天图标）
3. 选择参与者 `@xingseq`
4. 输入消息，观察流式回复

### 4. 打包

```bash
npm run package
```

产出 `xingseq-agent-0.1.0.vsix`，可安装到 VS Code / VSCodium。

## 依赖的 Server API

扩展要求 `workspace-app/src/server.mjs` 提供以下接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/conversation/new?workspacePath=xxx` | 新建对话 |
| GET | `/api/conversation/:id?workspacePath=xxx` | 加载对话历史 |
| POST | `/api/chat?workspacePath=xxx` | SSE 流式对话 |
| POST | `/api/confirm` | 确认/拒绝工具调用 |

## 设计要点

- 扩展不直接依赖 `@xingseq/chat-core`，而是通过子进程 server 解耦，避免 Extension Host 的模块解析问题。
- server 路径优先读取用户配置 `xingseq.serverPath`，留空时自动在 workspace 中查找 `apps/workspace-app/src/server.mjs`。
- 每个 Chat 会话维护独立的 `conversationId`，复用 workspace-app 的对话持久化能力。
- 工具确认使用 VS Code 原生模态弹窗，替代浏览器侧的倒计时弹窗。
