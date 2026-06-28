# @xingseq/config-core

L1 基座层 — 配置管理与持久化。

## 职责

统一管理应用配置：模型配置、API Key 读取、通用设置、默认模型、工作目录等。所有配置读写均通过本包完成，上层无需关心存储细节。

## 主要 API

| 分类 | 函数 |
| --- | --- |
| 模型配置 | `saveModelConfig` / `loadModelConfig` |
| API Key | `getApiKeyByProvider` / `getDeepSeekApiKey` / `getKimiApiKey` / `getQwenApiKey` / `getDoubaoApiKey` |
| 通用设置 | `saveGeneralConfig` / `loadGeneralConfig` / `clearGeneralConfigCache` |
| 默认模型 | `saveDefaultModel` / `loadDefaultModel` |
| 工作目录 | `saveWorkingDirectory` / `loadWorkingDirectory` |
| Tavily | `getTavilyApiKey` |
| 代理开关 | `readProxyEnabled` |
| 系统模型 | `loadSystemModelConfig` |
| Provider 子模型 | `saveProviderSubModels` / `loadProviderSubModels` |

## 使用示例

```js
import { setSharedEnv } from '@xingseq/shared-utils/env'
import { readProxyEnabled, loadModelConfig } from '@xingseq/config-core'
import path from 'node:path'

// 壳层启动时注入环境
setSharedEnv({
  isCLI: true,
  getApp: async () => ({ getPath: (k) => path.join(os.homedir(), '.xingseq') }),
  proxyEnabledReader: readProxyEnabled,
  systemModelsPath: path.join(__dirname, 'config', 'systemModels.json')
})

// 读取模型配置
const models = await loadModelConfig()
```

## 设计要点

- 通过 `@xingseq/shared-utils` 的 `setSharedEnv` 注入运行时路径，不硬编码任何绝对路径。
- 通用设置带 3 秒内存缓存，避免频繁磁盘 IO。
- `readProxyEnabled` 作为回调注入 `shared-utils` 的 proxyManager，避免 L1 包间循环依赖。
