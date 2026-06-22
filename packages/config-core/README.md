# @xingseq/config-core

L1 基座：通用配置 / 模型配置 / API Key 取值。

## 迁入清单

裁剪自 `xingseq-develop/electron/data/configManager.js`（原 759 行 → 当前约 400 行）。

### 已迁入

| 分类 | 函数 |
| --- | --- |
| 模型配置 | `saveModelConfig` / `loadModelConfig` |
| API Key | `getApiKeyByProvider` + `getDeepSeekApiKey` / `getKimiApiKey` / `getQwenApiKey` / `getDoubaoApiKey` |
| 通用设置（3s 缓存）| `saveGeneralConfig` / `loadGeneralConfig` / `clearGeneralConfigCache` |
| 默认托底模型 | `saveDefaultModel` / `loadDefaultModel` |
| 工作目录 | `saveWorkingDirectory` / `loadWorkingDirectory` |
| Tavily | `getTavilyApiKey` |
| 代理开关 | `readProxyEnabled`（供 shared-utils 注入） |
| 系统模型只读 | `loadSystemModelConfig`（路径走 env 注入） |
| Provider 子模型 | `saveProviderSubModels` / `loadProviderSubModels` |

### 未迁入（延后）

- `saveCustomModelConfig` / `loadCustomModelConfig` → 依赖 sqlite database，待 **storage-core** 就绪
- `init/saveAdvancedMode` / `init/saveUnrestrictedMode` / `saveAllowedExecutables` / `initAllowedExecutables` → 反向依赖 `tools/utils/security`，归 **L3 安全管理**

## 解耦点

| 原版依赖 | 新做法 |
| --- | --- |
| `import { app } from '../cli/runtime.js'` | `helpers.getUserDataPath()` 经 `shared-utils` env.getApp 注入 |
| `electron/config/systemModels.json` 硬编码路径 | `setSharedEnv({ systemModelsPath })` 注入 |
| `getLogger`、`safeJsonParse` 相对路径 | 改自 `@xingseq/shared-utils` 子路径 |

## 壳层接入示例

```js
import { setSharedEnv } from '@xingseq/shared-utils/env'
import { readProxyEnabled } from '@xingseq/config-core'
import { app } from 'electron'
import path from 'node:path'

setSharedEnv({
  isCLI: false,
  getApp: async () => app,
  proxyEnabledReader: readProxyEnabled,         // ← 把 config 读回到 proxyManager
  systemModelsPath: path.join(__dirname, 'config', 'systemModels.json')
})
```

注意 `proxyEnabledReader` 是 config-core 暴露的 `readProxyEnabled`，把开关读法注入回 shared-utils 的 proxyManager，避免 L1 之间循环依赖。
