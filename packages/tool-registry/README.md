# @xingseq/tool-registry

L2 领域服务：**工具定义注册中心** + **统一执行入口** + **敏感操作确认（依赖注入）**。

## 范围

- ✅ 整体迁入 `electron/tools/definitions/` 全部 17 组工具定义（纯数据，零外部依赖）
- ✅ 新写 `registry.js`：替代原 `executors/index.js` 的超大 switch
- ✅ 新写 `confirmation.js`：移除对 electron / configManager / windowManager 的直接依赖，全部依赖注入
- ❌ 不迁入：`executors/`（按业务归属，下个阶段分包）、`utils/security/`、`nodeFactory/graphTemplates/flowGraphToolsExamples`、`timerScheduler`

## 子路径 exports

```js
import { createToolRegistry } from '@xingseq/tool-registry'
import { fileTools, getToolGroups } from '@xingseq/tool-registry/definitions'
import { createConfirmationManager } from '@xingseq/tool-registry/confirmation'
```

## 注册中心用法

```js
import { createToolRegistry } from '@xingseq/tool-registry'
import { fileTools } from '@xingseq/tool-registry/definitions'

const registry = createToolRegistry()

registry.register('file', {
  tools: fileTools,
  handlers: {
    read_file: async (args, ctx) => ({ content: await fs.readFile(args.path, 'utf8') })
    // ... 其它 file 工具的 handler
  }
})

const result = await registry.dispatch(
  { name: 'read_file', args: { path: '/tmp/x' } },
  { logger }
)
```

## 确认管理器用法（上层注入平台依赖）

```js
import { createConfirmationManager } from '@xingseq/tool-registry/confirmation'

const confirmation = createConfirmationManager({
  isCLI: process.env.NAJIE_CLI_MODE === 'true',
  showConfirmDialog: async ({ toolName, message, detail }) => {
    const r = await dialog.showMessageBox(mainWindow, { /* ... */ })
    return r.response === 1
  },
  countdownConfigReader: async () => {
    const r = await loadGeneralConfig()
    return r?.data?.toolCountdown || null
  },
  sendFrontendConfirm: async (payload) => {
    mainWindow.webContents.send('tool:requestConfirm', payload)
  }
})

if (confirmation.requiresConfirmation(toolName)) {
  const ok = await confirmation.confirmToolExecution(toolName, args)
  if (!ok) throw new Error('用户取消')
}

// IPC handler
ipcMain.on('tool:confirmResponse', (_, { confirmId, confirmed }) => {
  confirmation.resolvePendingConfirm(confirmId, confirmed)
})
```
