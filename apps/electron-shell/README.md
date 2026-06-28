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
