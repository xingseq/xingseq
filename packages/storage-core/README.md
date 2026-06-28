# @xingseq/storage-core

L1 基座层 — 本地持久化与安全存储。

## 职责

提供原子文件写入、AES 加密、sql.js 嵌入式数据库三种存储原语，供上层业务包构建各自的持久化逻辑。

## 主要 API

| 模块 | API |
| --- | --- |
| `atomicFile` | `atomicWrite(path, data)` / `atomicRead(path)` |
| `encryption` | `encrypt(plaintext, key)` / `decrypt(ciphertext, key)` |
| `database` | `initDatabase(options?)` / `getDatabase()` / `saveDatabase()` |

## 使用示例

```js
import { setSharedEnv } from '@xingseq/shared-utils/env'
import { initDatabase, getDatabase, saveDatabase } from '@xingseq/storage-core'

// 注入 userData 路径来源
setSharedEnv({ getApp: async () => ({ getPath: () => '/path/to/user-data' }) })

// 初始化数据库
const db = await initDatabase()
db.run('INSERT INTO conversations_global (id, title) VALUES (?, ?)', ['c1', 'hi'])
await saveDatabase()
```

## 设计要点

- `initDatabase` 支持 `{ createStatements, alterStatements }` 参数覆盖默认表结构。
- sql.js wasm 路径通过 `{ sqlJsConfig: { locateFile } }` 注入，适配不同打包环境。
- 数据库文件路径由 `shared-utils` env 注入，不硬编码。
# @xingseq/storage-core

L1 基座：原子文件 / AES 加密 / sql.js 数据库。

## 迁入清单

| 模块 | 来源 |
| --- | --- |
| `atomicFile` | `electron/utils/atomicFile.js`（原样） |
| `encryption` | `electron/utils/encryption.js`（仅改 logger import） |
| `database` | `electron/data/database.js`（解耦 + schemas 外置） |
| `schemas` | 从原 database.js 内联抽出的 7 张 CREATE + 3 条 ALTER |

## 解耦点

| 原版依赖 | 新做法 |
| --- | --- |
| `import { app } from '../cli/runtime.js'` | 经 `shared-utils` env.getApp 注入 |
| 硬编码 7 张表 CREATE 语句 | 抽到 `schemas.js`，`initDatabase({ createStatements, alterStatements })` 可覆盖 |
| sql.js wasm 路径 | 通过 `initDatabase({ sqlJsConfig: { locateFile } })` 注入 |

## 默认 schemas 的演进说明

`DEFAULT_CREATE_STATEMENTS` 当前包含 7 张业务表（对话、网站账号、对话分岔、AI 画画、自定义模型、流程执行、用户偏好）——它们本质上属于上层业务包。本阶段为保持行为一致先集中在这里，后续 L2/L3 各业务包就绪后应当通过 `registerSchema()` 自行注册，把对应行从默认列表里下沉到业务包。

## 未迁入（延后）

- `encryptionConfigManager.js`：385 行，含主密码注册/校验/恢复等业务流程，归 L3 或单独的 vault 包
- `emailEncryption.js`：邮件加密业务，归 L3
- `userPreferenceManager.js` 等基于 db 的具体 DAO，归对应业务包

## 使用示例

```js
import { setSharedEnv } from '@xingseq/shared-utils/env'
import { initDatabase, getDatabase, saveDatabase } from '@xingseq/storage-core'
import { app } from 'electron'

// 注入 userData 路径来源
setSharedEnv({ getApp: async () => app })

// 初始化
const db = await initDatabase()
db.run('INSERT INTO conversations_global (id, title) VALUES (?, ?)', ['c1', 'hi'])
await saveDatabase()
```
