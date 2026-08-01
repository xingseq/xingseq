# 星序引擎 (xingseq) - npm workspaces monorepo
# 用法：make <target>，无参数时显示帮助
#
# 跨平台兼容：所有目标均使用 Node.js 辅助脚本，
# 不依赖 awk / rm / uname / trap 等 Unix 专属工具。

.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# help
# ---------------------------------------------------------------------------
.PHONY: help
help: ## 显示帮助
	@node scripts/make-help.mjs

# ---------------------------------------------------------------------------
# 依赖
# ---------------------------------------------------------------------------
# 注意：Windows 11 (build 26200+) 的 "untrusted mount point" 安全策略会阻止
# npm 为 workspace 包创建的 junction 被遍历，导致 npm install 在 createBinLinks
# 阶段报 UNKNOWN (-4094) / lstat 错误。
# 解决方案：使用 --no-bin-links 跳过 bin 链接创建（失败点），再用
# fix-workspace-links.mjs 将不可遍历的 junction 替换为目录拷贝。
.PHONY: install
install: ## 安装全部依赖（含所有 workspace）
	@echo "安装依赖..."
	npm install --no-bin-links
	@node scripts/fix-workspace-links.mjs

# ---------------------------------------------------------------------------
# 开发
# ---------------------------------------------------------------------------
.PHONY: dev chat chat-dry chat-live chat-list server web web-install web-dev mail mail-dry mail-test mail-once
dev: ## 启动 chat-app CLI 交互模式
	npm start -w apps/chat-app

chat: dev ## dev 的别名

chat-dry: ## chat-app dry-run 模式（不实际调用 LLM）
	npm run dry -w apps/chat-app

chat-live: ## chat-app live 模式
	npm run live -w apps/chat-app

chat-list: ## 列出 chat-app 可用工具
	npm run list -w apps/chat-app

server: ## 启动 HTTP+SSE 后端（:3001）
	npm run server -w apps/chat-app

web: ## 启动 Web 前端（Vite :5173）
	npm run web -w apps/chat-app

web-install: ## 安装 Web 前端依赖（首次）
	npm run web:install -w apps/chat-app

web-dev: ## 一键启动 Web 开发环境（后端 :3001 + 前端 :5173）
	@echo "启动中... 浏览器打开 http://localhost:5173（Ctrl+C 退出）"
	node scripts/dev-concurrent.mjs apps/chat-app server web

# ---------------------------------------------------------------------------
# 邮件网关
# ---------------------------------------------------------------------------
mail: ## 启动邮件网关（真实邮箱 + 真实 LLM）
	npm run gateway -w apps/mail-app

mail-dry: ## 启动邮件网关 dry 模式（虚拟邮箱 + mock LLM，完全离线）
	npm run gateway:dry -w apps/mail-app

mail-mock: ## 启动邮件网关 mock 模式（虚拟邮箱 + 真实 LLM）
	npm run gateway:mock -w apps/mail-app

mail-test: ## 向虚拟邮箱投递一封测试邮件
	npm run send-test -w apps/mail-app

mail-once: ## 单次对话测试（不启动监听）
	npm run once -w apps/mail-app

# ---------------------------------------------------------------------------
# 工作区助手 (workspace-app)
# ---------------------------------------------------------------------------
.PHONY: ws ws-dry ws-live ws-list ws-server ws-web ws-web-install ws-web-dev ws-test continue-bridge
ws: ## 启动 workspace-app CLI 交互模式
	npm start -w apps/workspace-app

ws-dry: ## workspace-app dry-run 模式
	npm run dry -w apps/workspace-app

ws-live: ## workspace-app live 模式
	npm run live -w apps/workspace-app

ws-list: ## 列出 workspace-app 可用工具
	npm run list -w apps/workspace-app

ws-server: ## 启动 workspace-app HTTP+SSE 后端（:3002）
	npm run server -w apps/workspace-app

ws-web: ## 启动 workspace-app Web 前端（Vite :5174）
	npm run web -w apps/workspace-app

ws-web-install: ## 安装 workspace-app 前端依赖（首次）
	npm run web:install -w apps/workspace-app

ws-web-dev: ## 一键启动 workspace-app Web 开发环境（后端 :3002 + 前端 :5174）
	@echo "启动中... 浏览器打开 http://localhost:5174（Ctrl+C 退出）"
	node scripts/dev-concurrent.mjs apps/workspace-app server web

ws-test: ## 运行 workspace-app 烟雾测试
	npm test -w apps/workspace-app

continue-bridge: ## 启动 Continue.dev 桥接服务（:3003），当前目录作为工作区
	@node scripts/continue-bridge.mjs

# ---------------------------------------------------------------------------
# Electron 综合控制台
# ---------------------------------------------------------------------------
.PHONY: electron electron-sign electron-build electron-web-install

electron: ## 启动 Electron 综合控制台（macOS 经 LaunchServices 启动以使 TCC 授权生效）
	@node scripts/ensure-electron-signing.mjs
	@node scripts/launch-electron.mjs

electron-sign: ## 单独执行 Electron 签名修复（修复缺失 Frameworks/、隔离属性、CMS blob 等问题）
	@node scripts/ensure-electron-signing.mjs

electron-web-install: ## 安装控制台前端依赖（首次）
	npm run web:install -w apps/electron-shell

electron-build: ## 构建控制台 + 各子应用前端并启动综合控制台
	npm run web:build -w apps/electron-shell
	npm run web:build -w apps/workspace-app
	npm run web:build -w apps/chat-app
	npm run web:build -w apps/llm-manager
	@node scripts/ensure-electron-signing.mjs
	@node scripts/launch-electron.mjs

# ---------------------------------------------------------------------------
# LLM 管理器
# ---------------------------------------------------------------------------
.PHONY: llm llm-server llm-web llm-web-install llm-web-dev

llm-server: ## 启动 LLM 管理器后端（:7820）
	npm run server -w apps/llm-manager

llm-web: ## 启动 LLM 管理器前端（Vite :5178）
	npm run web -w apps/llm-manager

llm-web-install: ## 安装 LLM 管理器前端依赖（首次）
	npm run web:install -w apps/llm-manager

llm-web-dev: ## 一键启动 LLM 管理器开发环境（后端 :7820 + 前端 :5178）
	@echo "启动中... 浏览器打开 http://localhost:5178（Ctrl+C 退出）"
	node scripts/dev-concurrent.mjs apps/llm-manager server web

# ---------------------------------------------------------------------------
# 构建
# ---------------------------------------------------------------------------
.PHONY: build web-build ws-web-build llm-web-build electron-web-build
build: web-build ws-web-build llm-web-build electron-web-build ## 构建所有产物

web-build: ## 构建 chat-app Web 前端
	npm run web:build -w apps/chat-app

ws-web-build: ## 构建 workspace-app Web 前端
	npm run web:build -w apps/workspace-app

llm-web-build: ## 构建 llm-manager Web 前端
	npm run web:build -w apps/llm-manager

electron-web-build: ## 构建控制台（electron-shell）Web 前端
	npm run web:build -w apps/electron-shell

# ---------------------------------------------------------------------------
# 代码质量
# ---------------------------------------------------------------------------
.PHONY: test lint
test: ## 运行测试（chat-app --once）
	npm test -w apps/chat-app

lint: ## 代码检查（预留）
	@echo "lint: 暂未配置 eslint，跳过"

# ---------------------------------------------------------------------------
# 脚手架 / 工具
# ---------------------------------------------------------------------------
.PHONY: scaffold ls
scaffold: ## 运行 scaffold 脚手架生成新模块
	npm run scaffold

ls: ## 列出所有 workspace 包
	npm run ls:pkgs

# ---------------------------------------------------------------------------
# 清理
# ---------------------------------------------------------------------------
.PHONY: clean clean-all
clean: ## 清理构建产物
	@echo "清理 web 构建产物..."
	node -e "require('node:fs').rmSync('apps/chat-app/web/dist',{recursive:true,force:true})"

clean-all: clean ## 清理全部（含 node_modules）
	@echo "清理 node_modules..."
	node -e "const fs=require('node:fs'),path=require('node:path');const dirs=['node_modules','apps/chat-app/web/node_modules'];for(const dir of ['apps','packages']){try{for(const name of fs.readdirSync(dir)){dirs.push(path.join(dir,name,'node_modules'))}}catch{}}dirs.forEach(function(d){fs.rmSync(d,{recursive:true,force:true})});console.log('  done')"

# ---------------------------------------------------------------------------
# 环境信息
# ---------------------------------------------------------------------------
.PHONY: env-info
env-info: ## 显示开发环境版本
	@node -e "const os=require('os'),cp=require('child_process');console.log('Node:  '+process.version);console.log('npm:   '+cp.execSync('npm -v').toString().trim());console.log('OS:    '+os.platform()+' '+os.arch());console.log('镜像:  '+cp.execSync('npm config get registry').toString().trim())"
