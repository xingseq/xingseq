# @xingseq/shared-utils

L1 基座层 — 通用基础设施与工具库。纯 Node.js，不依赖 Electron 与 React。

## 职责

为所有上层包提供 logger、代理管理、时间格式化、JSON 工具、Provider 常量等基础能力。

## 主要模块

| 模块 | 说明 |
|---|---|
| `logger.js` | 分级日志（info/warn/error/debug），支持文件输出 |
| `proxyManager.js` | HTTP/HTTPS 代理管理，按需启停 |
| `timestamp.js` | 本地时间格式化 |
| `jsonUtils.js` | 安全 JSON 解析 |
| `constants/providerConstants.js` | LLM Provider 枚举与模型映射 |
| `env.js` | 环境注入点（`setSharedEnv` / `getSharedEnv`） |

## 使用

```js
import {
  setSharedEnv,
  getLogger,
  getProxyUrl,
  formatLocalTimestamp
} from '@xingseq/shared-utils'

// 壳层启动时注入环境（一次性）
setSharedEnv({
  isCLI: true,
  getApp: async () => ({ getPath: () => '/path/to/user-data' }),
  proxyEnabledReader: async () => false
})

// 任意位置获取 logger
const logger = getLogger('MyModule')
logger.info('hello')
```

## 设计约束

- 不允许 import 任何 `@xingseq/*` 包（自身是 L1 最底层，反向依赖会破坏分层）。
- 不允许 import `electron` / `react` / `reactflow` 等运行时绑定包。
- 唯一允许的运行时依赖：`electron-log`（动态 import，CLI 模式下被替换为文件日志）。
