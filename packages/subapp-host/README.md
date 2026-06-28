# @xingseq/subapp-host

L2 领域层 — 子应用宿主环境。

## 定位

为 L4 应用提供统一的注册、进程管理、CLI 路由与 UI 挂载能力，使多个应用可在同一 Electron 壳或独立进程中共存运行。

## 计划能力

- 子应用注册表（声明式 manifest）
- 进程模型：主进程托管 / 独立子进程
- CLI 命令路由：统一入口分发到各子应用
- UI 挂载点管理（Electron webview / iframe）
- 子应用级记忆隔离

## 状态

脚手架占位，核心 API 尚未迁入。
