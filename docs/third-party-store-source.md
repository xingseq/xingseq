# 第三方商店源指南

XingSeq 应用商店支持三层应用分发：

1. **内置应用** — monorepo `apps/` 目录，随主仓库发布；
2. **官方商店源** — `xingseq-agent-hub` 仓库的 `sub-apps-registry.json`（GitHub）；
3. **第三方商店源** — 任何人自建的应用注册中心，通过控制台「应用商店 → 商店源」添加。

本文档面向**想开设第三方商店源的人**，说明需要准备什么、格式怎么写、以及背后的机制与限制。

---

## 一、工作原理

控制台（electron-shell）通过 `skill-host` 完成整条链路：

```
商店源 registry JSON          应用仓库
      │                          │
      │ ① 拉取注册表              │ ③ git clone --depth 1
      │   （多源合并去重）         │
      ▼                          ▼
  subApps 列表  ──② 拉取远程 manifest──▶  版本对比（检查更新）
                                 │
                                 ▼
                    ④ npm install --omit=dev
                    ⑤ 按需构建 UI（requireBuild）
                    ⑥ 安装到 ~/Library/Application Support/xingseq/projects/<name>/
```

因此开设一个商店源，本质上只需要：**一个可被 HTTP 访问的 registry JSON** + **每个应用一个可被 git clone 的仓库**。

---

## 二、需要准备的内容

### 2.1 Registry JSON（商店源本体）

一个能通过 `HTTP/HTTPS GET` 直接访问、返回合法 JSON 的地址即可，例如：

- Gitea/GitLab raw 文件地址
- 任意静态文件服务器 / 对象存储

**格式要求：**

```json
{
  "version": 1,
  "subApps": [
    {
      "name": "my-app",
      "repo": "http://192.168.31.31:3000/ws/my-app",
      "branch": "main",
      "manifestPath": "sub-app-manifest.json",
      "source": "gitea"
    }
  ]
}
```

顶层必须包含 `subApps` 数组，否则添加源时会被拒绝（"缺少 subApps"）。

**条目字段说明：**

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 子应用唯一名称，与仓库内 manifest 的 `name` 一致 |
| `repo` | 是 | 应用仓库地址，必须支持匿名 `git clone` |
| `branch` | 否 | 分支，默认 `main` |
| `manifestPath` | 否 | manifest 在仓库中的路径，默认 `sub-app-manifest.json`（仓库根目录） |
| `source` | 否 | 来源类型：`github`（缺省）或 `gitea`，决定远程 manifest 的拉取方式，见 2.3 |
| `rawUrlTemplate` | 否 | 自定义 raw manifest URL 模板（优先级高于 `source`），见 2.3 |

### 2.2 应用仓库要求

每个上架的应用仓库需要满足：

1. **可匿名克隆**：安装走 `git clone --depth 1 --branch <branch> <repo>`，不支持需要认证输入的仓库；
2. **根目录（或 `manifestPath` 指定位置）有 `sub-app-manifest.json`**，格式见下；
3. **如有 Node 依赖**，根目录放 `package.json`（安装时执行 `npm install --omit=dev --ignore-scripts`）；
4. **版本号维护**：发新版时必须 bump manifest 里的 `version` 字段，否则客户端检测不到更新。

**sub-app-manifest.json 示例（含可选字段）：**

```json
{
  "name": "my-app",
  "displayName": "我的应用",
  "description": "应用简介",
  "version": "1.0.0",
  "ui": {
    "enabled": true,
    "port": 3200,
    "portEnv": "PORT",
    "server": "src/server.mjs",
    "healthPath": "/api/health",
    "routes": ["/"],
    "requireBuild": false,
    "buildCommand": ""
  },
  "cli": {
    "enabled": true,
    "bin": "src/cli.mjs",
    "style": "direct",
    "commands": {}
  }
}
```

- `ui`：Web 界面。`port` 避免与内置应用冲突（chat-app 3001 等）；`server` 是控制台 spawn 的入口；`healthPath` 用于就绪探测。
- `ui.requireBuild` + `ui.buildCommand`：为 `true` 时安装流程会在 clone 后执行该命令构建前端（如 `npm run web:build`）。若你的仓库已提交构建产物 `dist/`，保持 `false` 可加快安装。
- `cli`：可选的命令行能力，`commands` 声明可被宿主路由的子命令。

### 2.3 远程 manifest 的拉取方式（`source` / `rawUrlTemplate`）

检查更新时，客户端需要**不 clone 仓库**就直接拿到远程 manifest 对比版本。不同托管平台的 raw 文件路径不同，通过条目字段声明：

- **缺省 / `source: "github"`**：`github.com` 改写为 `raw.githubusercontent.com`，拼 `/<branch>/<manifestPath>`；
- **`source: "gitea"`**：按 Gitea 约定拼 `<repo>/raw/branch/<branch>/<manifestPath>`；
- **`rawUrlTemplate`**：其它平台（GitLab、自建服务等）可用自定义模板，支持占位符 `{repo}` `{branch}` `{manifestPath}`：

  ```json
  {
    "name": "my-app",
    "repo": "https://gitlab.example.com/ws/my-app",
    "branch": "main",
    "manifestPath": "sub-app-manifest.json",
    "rawUrlTemplate": "{repo}/-/raw/{branch}/{manifestPath}"
  }
  ```

  优先级：`rawUrlTemplate` > `source` > GitHub 默认。

> ⚠️ 非 GitHub 源如果不声明 `source: "gitea"` 或 `rawUrlTemplate`，更新检测会静默失败（应用永远不显示「有更新」）。安装不受影响。

---

## 三、发布与更新流程

1. 应用仓库改代码 → bump `sub-app-manifest.json` 的 `version` → 提交推送到 `branch`；
2. 新应用上架：在 registry JSON 中新增条目并推送；
3. 客户端打开应用商店点「刷新」（强制绕过 5 分钟缓存）即可看到更新。

**更新机制说明：**

- 更新 = 删除本地安装目录后重新 clone 安装（非增量）；
- 应用自己的数据不在安装目录内，不受影响；
- **更新前请先在子应用管理里停掉该应用**（当前不会自动停止运行中的进程）；
- 版本对比是字符串不相等判断（非 semver 比较），版本号回退也会被标记为「有更新」。

---

## 四、用户侧使用方式

1. 打开控制台「应用商店」→「商店源」；
2. 填入源名称与 registry JSON 地址 →「添加」。添加时会**试拉一次**验证可达性和格式，失败会直接提示原因；
3. 第三方源的应用安装前会弹出**信任警示**（第三方代码将在本机执行，用户确认后才继续）；
4. 卡片上带来源徽章（官方 / 源名称），安装、更新、卸载与官方源一致。

**合并规则：** 多源按顺序合并（官方源恒在首位），同名 `name` 先到先得——即官方源条目优先，第三方源的同名应用会被丢弃。给应用取名时避免与官方撞名。

---

## 五、常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 添加源报「拉取注册中心失败: fetch failed (xxx)」 | 括号里是真实网络原因（如 `ECONNREFUSED`、`EHOSTUNREACH`）。局域网 IP 源在 macOS 上需要给控制台授予「隐私与安全性 → 本地网络」权限后**重启应用** |
| 添加源报「缺少 subApps 数组」 | registry JSON 格式不符，检查顶层结构 |
| 源添加成功但列表为空 | 该源的条目与官方源同名被去重丢弃，或条目本身为空 |
| 应用始终不显示「有更新」 | 非 GitHub 源未声明 `source`/`rawUrlTemplate`（见 2.3）；或远程 `version` 未 bump |
| 更新后界面仍是旧版 | 更新前应用正在运行未停止；停掉后重新更新，或重启控制台 |
| 刚改完 registry 刷新没变化 | 注册表有 5 分钟 TTL 缓存，点「刷新」按钮会强制重拉；仍无效则重启控制台 |

---

## 六、安全须知

- 第三方源的应用在用户本机执行 clone、install、build 全流程，**等同于运行来源不明的代码**；客户端已强制在安装前展示信任警示，源运营者也应确保仓库内容可信；
- registry JSON 与应用仓库地址建议使用 HTTPS（局域网自建 HTTP 可用，但公网源强烈建议 HTTPS）；
- 官方源不可删除、不可禁用，始终排在合并结果首位。

---

## 相关代码

- 注册表拉取与合并、manifest URL 解析：`packages/skill-host/src/registry.js`
- 商店源持久化与校验：`packages/skill-host/src/sources.js`
- 安装/卸载/更新引擎：`packages/skill-host/src/installer.js`
- 更新检测：`packages/skill-host/src/status.js`
- 控制台网关端点与前端：`apps/electron-shell/src/main.mjs`、`apps/electron-shell/web/src/components/AppStore.jsx`
