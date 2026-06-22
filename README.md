# 星序引擎 · 拆分版工作区

按"基座 → 能力 → 应用"分层切分的星序引擎重组工作区。

## 来源说明

- 原始代码仓库：`/Users/ws/Dev/xingseq-develop`（**只读参考**，本工作区不修改它）
- 本工作区采取**按需迁入**策略：每个阶段只迁入该层需要的源码，不做整库复制。

## 分层架构

```
L4 apps     | chat-app · workspace-app · chatroom-app · flow-studio · electron-shell
L3 能力     | ai-butler · flow-engine ·（agent-runtime 待迁入）
L2 领域     | tool-registry · memory-store · skill-host · subapp-host
L1 基座     | shared-utils · config-core · storage-core · llm-core
```

铁规：上层只能 import 下层；同层不互相依赖。

## 阶段路线

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 建工作区骨架（占位包 + scaffold 脚本 + workspaces 配置） | 进行中 |
| 1 | 迁入 L1 基座代码（shared-utils → config-core → storage-core → llm-core） | 待开始 |
| 2 | 迁入 L2 领域服务 | 待开始 |
| 3 | 迁入 L3 能力层 | 待开始 |
| 4 | 拆 L4 应用层 + electron-shell | 待开始 |
| 5 | 依赖图审计、清理 re-export 适配层 | 待开始 |

详细蓝图见 `docs/split-plan.md`（后续补齐）。

## 操作命令

```bash
# 重新生成/补齐占位包（幂等）
npm run scaffold

# 安装依赖（阶段 1 之后才有真实依赖需要装）
npm install
```
