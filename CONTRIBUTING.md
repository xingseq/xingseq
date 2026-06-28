# Contributing to XingSeq

感谢你对星序引擎的关注！以下是参与贡献的指南。

## 开发环境

- **Node.js** >= 18
- **npm** >= 9（使用 workspaces）
- macOS / Linux（Windows 未充分测试）

```bash
git clone git@github.com:xingseq/xingseq.git
cd xingseq
npm install
make chat-dry   # 验证环境（无需 API Key）
```

## 项目结构

```
packages/    L1-L3 层级包（基座 → 领域 → 能力）
apps/        L4 应用（chat-app, workspace-app, mail-app 等）
scripts/     构建与脚手架脚本
local/       本地开发笔记（已 gitignore）
```

## 分支与提交规范

- 主分支：`main`
- 功能分支：`feat/<短描述>` 或 `fix/<短描述>`
- Commit message 使用中文，格式参考 Conventional Commits：

```
feat(chat-core): 新增对话分岔支持
fix(llm-core): 修复 Qwen 流式解析在空 chunk 时异常
docs: 补充 workspace-app README
chore(repo): 清理过期依赖
```

## 代码规范

- 使用 ESM（`import/export`），`"type": "module"`
- 严格遵守分层依赖约束：上层可依赖下层，同层不互相依赖
- 工具函数放 `shared-utils`，业务逻辑按层归属
- 使用 JSDoc 注释关键函数，标明参数与返回值

## 测试

```bash
make test           # 运行冒烟测试
make chat-dry       # 无 API Key 的 ReAct 循环集成验证
```

提交前请确保 `make test` 通过。

## 提 Issue / PR

- Issue 请说明复现步骤、环境信息、期望行为
- PR 请关联对应 Issue，并简要描述改动内容
- 大改动建议先开 Issue 讨论方案

## 许可

贡献代码将采用 MIT 许可发布（与项目一致）。
