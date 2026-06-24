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
.PHONY: dev chat chat-dry chat-live chat-list server web
dev: ## 启动 chat-app CLI 交互模式
	npm start -w apps/chat-app

chat: dev ## dev 的别名

chat-dry: ## chat-app dry-run 模式（不实际调用 LLM）
	npm run dry -w apps/chat-app

chat-live: ## chat-app live 模式
	npm run live -w apps/chat-app

chat-list: ## 列出 chat-app 可用工具
	npm run list -w apps/chat-app

server: ## 启动 HTTP+SSE 后端
	npm run server -w apps/chat-app

web: ## 启动 Web 前端（Vite 开发服务器）
	npm run web -w apps/chat-app

# ---------------------------------------------------------------------------
# 构建
# ---------------------------------------------------------------------------
.PHONY: build web-build
build: web-build ## 构建所有产物

web-build: ## 构建 Web 前端
	npm run web:build -w apps/chat-app

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
