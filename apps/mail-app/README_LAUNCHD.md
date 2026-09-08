# mail-app macOS 后台常驻运行指南

本指南介绍如何通过 macOS 的 `launchd` 将 `mail-app` 邮件网关部署为后台常驻服务，实现开机自动启动、崩溃自动重启。

---

## 文件位置

| 文件 | 路径 |
|------|------|
| 服务描述文件（plist） | `apps/mail-app/com.xingseq.mail-app.plist` |
| 安装位置 | `~/Library/LaunchAgents/com.xingseq.mail-app.plist` |
| 标准输出日志 | `~/.xingseq/mail-app/logs/gateway.stdout.log` |
| 错误日志 | `~/.xingseq/mail-app/logs/gateway.stderr.log` |

---

## 前置条件

1. 已配置 `~/.xingseq/mail-app/config/mail.json`。
2. 已确认 `mail-app` 可正常运行，例如：
   ```bash
   npm run gateway:dry -w apps/mail-app
   ```
3. 默认调用 chat-app 使用 CLI 模式，无需额外启动 chat-app。若配置为 SSE 模式，则需确保 chat-app HTTP 服务已启动。

---

## 安装步骤

### 1. 创建日志目录

```bash
mkdir -p ~/.xingseq/mail-app/logs
```

### 2. 拷贝 plist 到 LaunchAgents

```bash
cp /path/to/xingseq/apps/mail-app/com.xingseq.mail-app.plist ~/Library/LaunchAgents/
```

### 3. 加载并启动服务

```bash
launchctl load ~/Library/LaunchAgents/com.xingseq.mail-app.plist
```

加载时会立即启动 `mail-app gateway`。

---

## 常用命令

### 查看服务状态

```bash
launchctl list | grep xingseq
```

输出示例：

```
-   0   com.xingseq.mail-app
```

第一列 `-` 表示当前已运行（若显示 PID 则表示正在运行）。

### 查看日志

```bash
# 实时查看输出日志
tail -f ~/.xingseq/mail-app/logs/gateway.stdout.log

# 查看错误日志
tail -f ~/.xingseq/mail-app/logs/gateway.stderr.log
```

### 日志轮转

网关自身按大小轮转日志（launchd 的 `StandardOutPath` 只增不减）：单个日志超过 **5MB** 时，复制为 `.1` 归档并把活动文件截断为 0，最多保留 **3** 份归档（`.1`/`.2`/`.3`）；启动时和每 10 分钟各检查一次。

- 归档文件：`gateway.stdout.log.1`、`gateway.stderr.log.1` …
- 可调环境变量：`MAIL_LOG_MAX_BYTES`（默认 5242880）、`MAIL_LOG_KEEP`（默认 3）

> 采用「复制→截断」而非「重命名」：launchd 以 `O_APPEND` 持有日志 fd，重命名会让它继续写入旧 inode；截断则让后续写入自动落到新文件头，无需重启服务。

### 停止服务

```bash
launchctl unload ~/Library/LaunchAgents/com.xingseq.mail-app.plist
```

### 重新启动服务

```bash
launchctl unload ~/Library/LaunchAgents/com.xingseq.mail-app.plist
launchctl load ~/Library/LaunchAgents/com.xingseq.mail-app.plist
```

### 开机自启动

`launchctl load` 加载后，`RunAtLoad` 会确保每次登录时自动启动该服务。重装系统或更换用户后需重新执行安装步骤。

---

## 配置说明

| 配置项 | 说明 |
|--------|------|
| `Label` | 服务唯一标识：`com.xingseq.mail-app` |
| `WorkingDirectory` | 运行目录：`/path/to/xingseq/apps/mail-app` |
| `ProgramArguments` | 执行命令：`node src/cli.mjs gateway` |
| `EnvironmentVariables.PATH` | 环境变量 PATH，包含 Homebrew 的 node |
| `RunAtLoad` | 加载时立即启动 |
| `KeepAlive` | 进程退出后自动重启 |
| `ThrottleInterval` | 最短重启间隔 10 秒，防止崩溃时频繁重启 |
| `StandardOutPath` | 标准输出日志路径 |
| `StandardErrorPath` | 标准错误日志路径 |

---

## 修改服务配置

1. 先停止服务：
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.xingseq.mail-app.plist
   ```

2. 修改 `~/Library/LaunchAgents/com.xingseq.mail-app.plist` 或项目源文件 `apps/mail-app/com.xingseq.mail-app.plist` 后重新拷贝。

3. 重新加载：
   ```bash
   launchctl load ~/Library/LaunchAgents/com.xingseq.mail-app.plist
   ```

---

## 卸载服务

```bash
launchctl unload ~/Library/LaunchAgents/com.xingseq.mail-app.plist
rm ~/Library/LaunchAgents/com.xingseq.mail-app.plist
```

---

## 注意事项

- plist 中使用的 Node 路径为 `/opt/homebrew/bin/node`。如果你的 node 安装路径不同，请修改 `ProgramArguments` 第一个参数。
- 如果 mail-app 启动失败，优先查看 `~/.xingseq/mail-app/logs/gateway.stderr.log`。
- `KeepAlive` 会在所有方式退出后都尝试重启。如果你希望手动停止后不再自动重启，可以先 `unload` 再停止。
- mail-app 的工作目录为 `apps/mail-app`，因此 npm workspaces 的依赖解析需要在该目录下通过 `node_modules` 找到。确保项目依赖已安装。
