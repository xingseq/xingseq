# @xingseq/electron-shell

L4 应用：XingSeq 综合控制台——子应用导航、按需启动、iframe 嵌入、子应用管理面板。

## 定位

将 Electron 窗口升级为 XingSeq 全部子应用的统一入口：

- **子应用发现**：通过 `@xingseq/subapp-host` 扫描 `apps/` 下带 `sub-app-manifest.json` 的子应用，自动注册到控制台
- **按需启动**：点击某个子应用时，控制台 spawn 其 server 进程并轮询 health 路径等待就绪
- **iframe 嵌入**：每个子应用在自己端口提供完整 UI（静态资源 + `/api` 同源），控制台用 `<iframe>` 按端口嵌入，无需改写各子应用前端的路由
- **管理面板**：查看所有子应用状态（运行/停止），执行启动/停止操作
- **外部进程采纳**：如果子应用端口已被外部进程占用且健康，控制台直接采纳，不重复 spawn

## 架构

```
Electron 主进程 (main.mjs)
  ├─ 控制台网关 (:5180)
  │   ├─ GET  /console/api/apps            → 子应用清单 + 运行状态
  │   ├─ POST /console/api/apps/:name/start → 按需启动子应用 server
  │   ├─ POST /console/api/apps/:name/stop  → 停止子应用 server
  │   └─ 静态资源 → electron-shell/web/dist
  └─ BrowserWindow → http://localhost:5180
        ├─ 左侧导航栏（子应用列表 + 管理面板入口）
        └─ <iframe> → http://localhost:{子应用端口}/
              ├─ workspace-app (:3002)
              ├─ chat-app (:3001)
              └─ llm-manager (:7820)
```

## 端口分配

| 服务 | 端口 | 环境变量 |
|------|------|----------|
| 控制台网关 | 5180 | `CONSOLE_PORT` |
| 控制台前端 dev | 5181 | Vite dev server |
| workspace-app | 3002 | `PORT` |
| chat-app | 3001 | `PORT` |
| llm-manager | 7820 | `LLM_MANAGER_PORT` |

## 用法

```bash
# 首次：安装控制台前端依赖
make electron-web-install
# 或 npm run web:install -w apps/electron-shell

# 构建控制台 + 各子应用前端，然后启动
make electron-build

# 已构建前端后直接启动
make electron
# 或 npm start -w apps/electron-shell
```

`make electron-build` 会依次构建以下前端：
1. `electron-shell/web` — 控制台界面
2. `workspace-app/web` — 工作区应用
3. `chat-app/web` — 对话应用
4. `llm-manager/web` — LLM 管理器

## 开发说明

### 目录结构

```
apps/electron-shell/
  src/
    main.mjs        # Electron 主进程 + 控制台网关
    preload.cjs     # 预加载脚本（暴露 isElectron / platform）
    index.js        # 包入口（re-export）
  web/              # 控制台前端（Vite + React）
    src/
      App.jsx       # 主界面：左侧导航 + iframe 宿主
      components/
        SubAppManager.jsx  # 子应用管理面板
      styles.css    # 暗色主题（复用 workspace-app 风格）
    vite.config.js  # dev 代理 /console → :5180
    package.json
```

### 控制台前端开发

```bash
# 终端 1：启动控制台（含网关 :5180）
npm start -w apps/electron-shell

# 终端 2：Vite dev server (:5181)，热更新
npm run web -w apps/electron-shell
# 浏览器打开 http://localhost:5181
```

Vite dev server 会将 `/console/api/*` 请求代理到 `:5180` 网关，其余请求由 Vite 提供 `web/src` 下的源码并热更新。

### 添加新子应用

1. 在子应用根目录创建 `sub-app-manifest.json`：

```json
{
  "name": "my-app",
  "displayName": "我的应用",
  "description": "应用描述",
  "version": "0.1.0",
  "ui": {
    "enabled": true,
    "port": 3003,
    "portEnv": "PORT",
    "server": "src/server.mjs",
    "healthPath": "/api/health"
  },
  "cli": {
    "enabled": true
  }
}
```

2. 确保子应用 server 自带静态 UI 服务（SPA fallback），参考 [workspace-app/src/server.mjs](../workspace-app/src/server.mjs) 或 [chat-app/src/server.mjs](../chat-app/src/server.mjs) 的静态路由实现。

3. 构建子应用前端到 `web/dist`。

4. 控制台启动时自动发现并显示在导航栏中。

### 兜底清单

如果 `subapp-host` 发现失败或无 manifest，控制台回退到内置的 `FALLBACK_APPS`（workspace-app、chat-app、llm-manager），确保基本可用。

## 依赖

- `@xingseq/subapp-host` — 子应用发现与 manifest 解析
- `electron` — 桌面窗口与进程管理

## 与原始设计的关系

按 [scripts/scaffold-workspace.mjs](../../scripts/scaffold-workspace.mjs) 的原始定位，`electron-shell` 是 **L4 应用：Electron 主进程壳、IPC 网关、CLI 入口**。

当前实现已完成「综合控制台」形态：多子应用导航、按需启动、iframe 嵌入、管理面板。后续将逐步补齐 IPC 网关与 CLI 入口能力。
# @xingseq/electron-shell

L4 应用：Electron 桌面壳，承载 workspace-app。

## 定位

把 `apps/workspace-app` 的 Web 前端包进 Electron 窗口，提供桌面级入口：

- 主进程自动拉起 workspace-app HTTP+SSE 服务（端口 3002）
- 内置静态文件 + API 代理服务（端口 5174），加载已构建的 `workspace-app/web/dist`
- 渲染进程通过 HTTP/SSE 与后端通信，无需改动 workspace-app 现有代码

## 用法

```bash
# 首次或前端有变更时，先构建 workspace-app 前端
npm run build -w apps/electron-shell

# 启动桌面壳
npm start -w apps/electron-shell

# 或 Makefile
make electron-build
```

## 开发说明

- 入口：`src/main.mjs`
- 预加载脚本：`src/preload.cjs`（当前仅暴露 `isElectron` / `platform` 标识）
- 依赖：`@xingseq/workspace-app`（workspace 链接）

## 与原始设计的关系

按 [`scripts/scaffold-workspace.mjs`](../../scripts/scaffold-workspace.mjs#L41-L41) 的原始定位，
`electron-shell` 是 **L4 应用：Electron 主进程壳、IPC 网关、CLI 入口**。

当前实现先聚焦在「桌面壳承载 workspace-app」这一最小可用形态；
IPC 网关、CLI 入口等能力随后续阶段逐步补齐，框架设计并未改变。
