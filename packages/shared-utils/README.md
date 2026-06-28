# @xingseq/shared-utils

L1 基座：logger / proxy / timestamp / 通用常量。**纯 Node、不依赖 electron 与 React**。

## 迁入清单

| 当前文件 | 来源 | 改造 |
|---|---|---|
| `src/logger.js` | `electron/utils/logger.js` | 去掉 `cli/runtime.js` 静态依赖，改为 env 注入 |
| `src/proxyManager.js` | `electron/utils/proxyManager.js` | 去掉 `data/configManager.js` 依赖，改为 env 注入 |
| `src/lazyLogger.js` | `electron/utils/lazyLogger.js` | 原样 |
| `src/logFormat.js` | `electron/utils/logFormat.js` | 原样 |
| `src/timestamp.js` | `electron/utils/timestamp.js` | 原样 |
| `src/jsonUtils.js` | `electron/utils/jsonUtils.js` | 原样 |
| `src/constants/providerConstants.js` | `electron/constants/providerConstants.js` | 原样 |
| `src/env.js` | （新建） | 环境注入点 |

## 不在本包内（后续阶段处理）

- `electron/utils/electronCompat.js` → electron-shell（阶段 4，绑定 electron 包）
- `electron/utils/capabilityLookup.js` → electron-shell（阶段 4，硬编码项目根路径）
- `electron/utils/encryption.js` → storage-core（阶段 1.3）
- `electron/utils/atomicFile.js` → storage-core（阶段 1.3）

## 使用

```js
import {
  setSharedEnv,          // 壳层在启动时注入环境
  initLogger,
  getLogger,
  getProxyUrl,
  formatLocalTimestamp
} from '@xingseq/shared-utils'

// 壳层启动期注入环境（一次性）
setSharedEnv({
  isCLI: false,
  getApp: async () => (await import('electron')).app,
  proxyEnabledReader: async () => (await loadGeneralConfig()).data?.useProxy === true
})

// 之后任意位置可获取 logger
const logger = getLogger('MyModule')
logger.info('hello')
```

## 设计约束

- 不允许 import 任何 `@xingseq/*` 包（自身是 L1 基座，反向依赖会破坏分层）。
- 不允许 import `electron`/`react`/`reactflow` 等运行时强绑定包。
- 唯一允许的运行时依赖：`electron-log`（动态 import，CLI 模式下可被替换）。
