# 星序引擎 (xingseq) - npm workspaces monorepo
# 用法：make <target>，无参数时显示帮助

.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# help
# ---------------------------------------------------------------------------
.PHONY: help
help: ## 显示帮助
	@awk 'BEGIN {FS = ":.*##"; printf "可用命令：\n"} \
		/^[a-zA-Z0-9_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }' \
		$(MAKEFILE_LIST)

# ---------------------------------------------------------------------------
# 依赖
# ---------------------------------------------------------------------------
.PHONY: install
install: ## 安装全部依赖（含所有 workspace）
	@echo "安装依赖..."
	npm install

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
	@trap 'kill 0' EXIT; \
	npm run server -w apps/chat-app & \
	npm run web -w apps/chat-app

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
.PHONY: ws ws-dry ws-live ws-list ws-server ws-web ws-web-install ws-web-dev ws-test
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
	@trap 'kill 0' EXIT; \
	npm run server -w apps/workspace-app & \
	npm run web -w apps/workspace-app

ws-test: ## 运行 workspace-app 烟雾测试
	npm test -w apps/workspace-app

# ---------------------------------------------------------------------------
# Electron 桌面壳
# ---------------------------------------------------------------------------
.PHONY: electron electron-build

electron: ## 启动 Electron 桌面壳（需先构建 workspace-app 前端）
	npm start -w apps/electron-shell

electron-build: ## 构建 workspace-app 前端并启动 Electron 桌面壳
	npm run build -w apps/electron-shell
	npm start -w apps/electron-shell

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
	@trap 'kill 0' EXIT; \
	npm run server -w apps/llm-manager & \
	npm run web -w apps/llm-manager

# ---------------------------------------------------------------------------
# 构建
# ---------------------------------------------------------------------------
.PHONY: build web-build ws-web-build llm-web-build
build: web-build ws-web-build llm-web-build ## 构建所有产物

web-build: ## 构建 chat-app Web 前端
	npm run web:build -w apps/chat-app

ws-web-build: ## 构建 workspace-app Web 前端
	npm run web:build -w apps/workspace-app

llm-web-build: ## 构建 llm-manager Web 前端
	npm run web:build -w apps/llm-manager

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
	rm -rf apps/chat-app/web/dist

clean-all: clean ## 清理全部（含 node_modules）
	@echo "清理 node_modules..."
	rm -rf node_modules apps/*/node_modules packages/*/node_modules apps/chat-app/web/node_modules

# ---------------------------------------------------------------------------
# 环境信息
# ---------------------------------------------------------------------------
.PHONY: env-info
env-info: ## 显示开发环境版本
	@echo "Node:  $$(node -v)"
	@echo "npm:   $$(npm -v)"
	@echo "OS:    $$(uname -s) $$(uname -m)"
	@echo "镜像:  $$(npm config get registry)"
