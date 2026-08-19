# 官方应用发布指南

XingSeq 应用商店支持三层应用分发：

1. **内置应用** — monorepo `apps/` 目录，随主仓库发布；
2. **官方商店源** — `xingseq-agent-hub` 仓库的 `sub-apps-registry.json`（GitHub）；
3. **第三方商店源** — 任何人自建的应用注册中心（见[第三方商店源指南](./third-party-store-source.md)）。

本文档面向**想把应用发布到官方商店源的应用作者**：说明应用仓库怎么准备、如何登记到官方注册中心、以及发版更新的注意事项。

> 如果你想自建一个商店源而不是发布单个应用，请阅读[第三方商店源指南](./third-party-store-source.md)。

---

## 一、发布链路总览

```
你的应用仓库 (github.com/xingseq/<app>)
      │
      │ ① 上架：在 xingseq-agent-hub 的 sub-apps-registry.json 登记条目
      ▼
官方注册中心 (github.com/xingseq/xingseq-agent-hub)
      │
      │ ② 用户打开应用商店：拉取注册表（5 分钟缓存，刷新强制重拉）
      ▼
用户客户端 (electron-shell / skill-host)
      │
      │ ③ 安装：git clone --depth 1 --branch main → npm install --omit=dev --ignore-scripts
      │    → 按需构建 UI（ui.requireBuild）
      │ ④ 检查更新：拉 raw.githubusercontent.com 上的 manifest 对比 version 字符串
      ▼
安装到 ~/Library/Application Support/xingseq/projects/<name>/
```

因此发布一个官方应用 = **一个 GitHub 公开仓库** + **在 hub 仓库登记一条 JSON**。

---

## 二、应用仓库要求

### 2.1 基础要求（checklist）

- [ ] **GitHub 公开仓库**，支持匿名 `git clone`（安装走 `git clone --depth 1 --branch <branch>`，不支持需要认证的仓库）；
- [ ] 仓库根目录（或 registry 条目 `manifestPath` 指定的位置）有 **`sub-app-manifest.json`**，且其中的 `name` 与 registry 条目的 `name` **完全一致**；
- [ ] 发版分支固定为 `main`（或如实在 registry 条目中声明 `branch`）；
- [ ] 有 Node 依赖时根目录放 `package.json`，运行时依赖列入 manifest 的 `dependencies.runtime`；
- [ ] 前端产物**预构建并提交**（推荐），或声明 `requireBuild: true` 由客户端构建（见 2.3）；
- [ ] 每次发版 **bump manifest 的 `version`**，否则用户端检测不到更新。

### 2.2 sub-app-manifest.json

以下是一个已上架应用（folder-sync）的真实 manifest：

```json
{
  "name": "folder-sync",
  "displayName": "文件夹同步",
  "description": "监控本地目录变更，增量单向同步到目标目录；源删除仅提醒不同步删除",
  "version": "0.1.1",
  "ui": {
    "enabled": true,
    "port": 8020,
    "portEnv": "PORT",
    "server": "src/server.mjs",
    "healthPath": "/api/health",
    "requireBuild": false,
    "routes": ["/"]
  },
  "cli": {
    "enabled": false
  },
  "dependencies": {
    "runtime": ["chokidar"]
  }
}
```

**字段说明：**

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 应用唯一名，与 registry 条目 `name` 一致；避免与其他官方应用撞名 |
| `displayName` | 否 | 商店与左侧列表显示名 |
| `description` | 否 | 应用简介 |
| `version` | 是 | 版本号；**更新检测的唯一依据**（字符串不等即提示更新，见第四节） |
| `ui.enabled` | 否 | 是否有 Web 界面 |
| `ui.port` | `ui` 启用时必填 | 固定端口，见 2.4 端口规划 |
| `ui.portEnv` | 否 | 通过哪个环境变量把端口传给 server 进程（默认 `PORT`） |
| `ui.server` | `ui` 启用时必填 | 控制台 spawn 的入口文件（相对仓库根） |
| `ui.healthPath` | 否 | 就绪探测路径，server 需实现该端点返回 200 |
| `ui.routes` | 否 | 需要网关代理的路由前缀 |
| `ui.requireBuild` / `ui.buildCommand` | 否 | `true` 时安装后执行 `buildCommand` 构建 UI，见 2.3 |
| `cli.enabled` / `cli.bin` / `cli.commands` | 否 | 可选的命令行能力 |
| `dependencies.runtime` | 否 | 运行时依赖清单（供安装器做 `npm install --omit=dev`） |

### 2.3 构建策略：`--ignore-scripts` 的影响

客户端安装时执行的是 `npm install --omit=dev --ignore-scripts`——**npm 生命周期脚本（含 postinstall）不会运行**。因此前端产物只有两种获得方式：

| 方式 | manifest 配置 | 说明 |
| --- | --- | --- |
| **预构建提交（推荐）** | `"requireBuild": false` | 把 `web/dist/` 等构建产物直接提交进仓库。安装快、无构建超时风险 |
| 客户端构建 | `"requireBuild": true` + `"buildCommand": "npm run web:build"` | 安装时在用户机器上执行构建命令（超时 120s；失败仅 UI 不可用，CLI 不受影响） |

注意：`buildCommand` 以**空格切分**为可执行文件与参数，不支持 shell 语法（管道、`&&`、引号嵌套等）。

### 2.4 端口规划

`ui.port` 是固定端口，全用户一致，必须避开已占用值：

| 应用 | 端口 | 类别 |
| --- | --- | --- |
| chat-app | 3001 | 内置 |
| workspace-app | 3002 | 内置 |
| llm-manager | 7820 | 内置 |
| mail-app | 7830 | 内置 |
| folder-sync | 8020 | 官方商店 |

新应用建议在 **8100–8999** 段选取并在上架评审时声明，避免互相冲突。应用应同时支持 `portEnv` 环境变量覆盖，给高级用户留出改端口的余地。

### 2.5 用户数据存放

**更新 = 删除整个安装目录后重新 clone**（见第四节）。因此应用自己产生的数据（任务、配置、缓存）**绝不能存在安装目录内**，约定放在：

```
~/.xingseq/<app-name>/        # 如 folder-sync 的 ~/.xingseq/folder-sync/tasks.json
```

这样更新/卸载重装时用户数据不丢。

### 2.6 其他安装约束

安装各步骤有超时保护，仓库规模受限于：

| 步骤 | 超时 |
| --- | --- |
| `git clone` | 120s |
| `npm install` | 180s |
| build（requireBuild） | 120s |

`npm install` 失败**不会回滚**安装（视为警告，可能部分功能不可用）；clone 失败或 manifest 缺失/损坏则整体失败。请保持仓库精简（shallow clone 体积小、依赖数量克制）。

---

## 三、上架到官方注册中心

官方注册中心是 GitHub 仓库 **`xingseq/xingseq-agent-hub`** 的 `sub-apps-registry.json`（`main` 分支）。

**条目格式（与当前在架应用一致）：**

```json
{
  "name": "my-app",
  "repo": "https://github.com/xingseq/my-app",
  "branch": "main",
  "manifestPath": "sub-app-manifest.json",
  "source": "github"
}
```

- 官方源应用托管在 GitHub，`source` 固定 `"github"`（缺省也按 GitHub 处理）；
- `name` 必须与仓库内 manifest 的 `name` 一致；
- 顶层必须含 `subApps` 数组，新增条目追加其中即可。

**修改方式（二选一）：**

1. 向 `xingseq/xingseq-agent-hub` 提交 PR，改动 `sub-apps-registry.json`；
2. 有写权限时直接用 GitHub API 更新文件：

   ```bash
   gh api -X PUT /repos/xingseq/xingseq-agent-hub/contents/sub-apps-registry.json \
     -f message="feat: add my-app to registry" \
     -f content="$(base64 -i sub-apps-registry.json)" \
     -f sha="<当前文件 sha>"
   ```

登记推送后，用户点应用商店「刷新」即可看到新应用（注册表有 5 分钟缓存，刷新按钮会强制重拉）。

---

## 四、发版与更新

**发版流程：**

1. 改代码 → **bump `sub-app-manifest.json` 的 `version`** → 提交推送到 `branch` 声明的分支（`main`）；
2. 完成。用户打开应用商店（或点「刷新」）时，客户端拉取 raw 地址上的 manifest 对比版本：

   ```
   https://raw.githubusercontent.com/xingseq/<app>/<branch>/sub-app-manifest.json
   ```

   版本不同即在卡片上显示「有更新」徽章，用户点击「更新」执行。

**机制细节（作者需要知道的）：**

- **更新是删了重装**，不是增量拉取：删除 `projects/<name>/` → 重新 clone 最新 `main` → 依赖安装 → 按需构建。数据请按 2.5 存放；
- **版本比较是字符串不等判断**（非 semver）：`0.1.1` 与 `0.1.01` 也会触发更新提示；版本号回退同样提示；
- 更新**不会自动停止正在运行的应用进程**，用户需先在子应用管理里停掉该应用再更新——建议在你的应用文档/README 中提醒用户；
- manifest 拉取失败是**静默跳过**的（仅 debug 日志）：raw 地址不可达时用户永远看不到「有更新」。GitHub 公开仓库一般无此问题，但发版后可按第五节命令自检确认。

---

## 五、上架前自检清单

上架推送后，逐条执行以下命令模拟客户端真实链路（全部应通过）：

```bash
# 1. 匿名 shallow clone（模拟安装第一步）
git clone --depth 1 --branch main https://github.com/xingseq/my-app /tmp/my-app-test

# 2. manifest 可解析、name/version 正确
cat /tmp/my-app-test/sub-app-manifest.json

# 3. raw manifest 可访问（模拟更新检测；返回应为 manifest JSON 本体）
curl -fsSL https://raw.githubusercontent.com/xingseq/my-app/main/sub-app-manifest.json

# 4. 依赖可安装（模拟安装第二步）
cd /tmp/my-app-test && npm install --omit=dev --ignore-scripts

# 5. UI server 可启动且健康检查通过（按你 manifest 的 server/healthPath 调整）
node src/server.mjs & sleep 2 && curl -fsS http://127.0.0.1:8100/api/health
```

---

## 六、常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 用户看不到「有更新」 | 发版没 bump manifest `version`；或推送的不是 `branch` 声明的分支 |
| 用户更新后界面还是旧版 | 更新前应用在运行未停止；提醒用户先停应用再更新 |
| 安装时 UI 构建失败 | `requireBuild: true` 但 `buildCommand` 含 shell 语法或依赖未装全；改用预构建提交 + `requireBuild: false` |
| 安装慢 / clone 超时 | 仓库体积大（shallow clone 也受影响）；清理无关文件、避免提交 node_modules |
| 应用端口冲突 | `ui.port` 与已占用端口撞车，见 2.4 |
| 更新后用户数据丢失 | 数据写进了安装目录；迁移到 `~/.xingseq/<app-name>/` |
| 上架后商店里没出现 | 注册表 5 分钟缓存；用户点「刷新」强制重拉 |

---

## 相关链接

- 机制实现：`packages/skill-host/src/registry.js`（注册表拉取/manifest URL 解析）、`installer.js`（安装/更新引擎）、`status.js`（更新检测）
- 客户端网关与 UI：`apps/electron-shell/src/main.mjs`、`apps/electron-shell/web/src/components/AppStore.jsx`
- 自建商店源请参考：[第三方商店源指南](./third-party-store-source.md)
