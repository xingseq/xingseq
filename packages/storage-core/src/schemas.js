/**
 * 默认数据库 schema 定义
 *
 * 注：这 7 张表来自 develop electron/data/database.js 的硬编码 CREATE TABLE，
 * 它们本质上是业务表（对话、网站账号、流程执行、用户偏好等），但当前阶段
 * 为了保持与原版行为一致，先集中在 storage-core 里。
 *
 * 演进路径：随着 L2/L3 业务包陆续迁入，应把对应 schema 从这里拆出去，
 * 由各业务包通过 registerSchema() 自行注册。届时 storage-core 的默认
 * schemas 只剩"完全不属于任何业务包"的基础表（如可能空）。
 */

/**
 * 标准建表语句（CREATE TABLE IF NOT EXISTS）
 */
export const DEFAULT_CREATE_STATEMENTS = [
  // 全局对话
  `CREATE TABLE IF NOT EXISTS conversations_global (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    preview TEXT,
    date TEXT,
    source TEXT,
    imported INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME DEFAULT NULL
  )`,
  // 网站账号密码
  `CREATE TABLE IF NOT EXISTS website_accounts (
    id TEXT PRIMARY KEY,
    website_name TEXT NOT NULL,
    website_url TEXT,
    category TEXT,
    account TEXT,
    password TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME DEFAULT NULL
  )`,
  // 对话分岔
  `CREATE TABLE IF NOT EXISTS conversation_forks (
    id TEXT PRIMARY KEY,
    source_conversation_id TEXT NOT NULL,
    forked_conversation_id TEXT NOT NULL,
    fork_type TEXT NOT NULL,
    fork_message_index INTEGER,
    project_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  // AI 画画历史
  `CREATE TABLE IF NOT EXISTS ai_draw_history (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    model TEXT NOT NULL,
    resolution TEXT,
    style TEXT,
    tags TEXT,
    image_name TEXT NOT NULL,
    image_path TEXT,
    thumbnail_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME DEFAULT NULL
  )`,
  // 自定义模型参数
  `CREATE TABLE IF NOT EXISTS custom_models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    sub_model TEXT,
    temperature REAL,
    stream INTEGER DEFAULT 1,
    system_prompt TEXT,
    tags TEXT,
    working_directory TEXT,
    use_tools INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  // 流程执行历史
  `CREATE TABLE IF NOT EXISTS flow_execution_history (
    id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL,
    graph_name TEXT NOT NULL,
    initial_input TEXT,
    execution_status TEXT NOT NULL,
    execution_order TEXT,
    node_statuses TEXT,
    execution_context TEXT,
    execution_logs TEXT,
    log_file_path TEXT,
    error_message TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  // 用户偏好
  `CREATE TABLE IF NOT EXISTS user_preferences (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`
]

/**
 * 兼容旧库的 ALTER 语句（首次成功执行后即失效，重复执行不报错由调用方静默吞错）
 */
export const DEFAULT_ALTER_STATEMENTS = [
  'ALTER TABLE ai_draw_history ADD COLUMN thumbnail_path TEXT',
  'ALTER TABLE custom_models ADD COLUMN use_tools INTEGER DEFAULT 1',
  'ALTER TABLE flow_execution_history ADD COLUMN log_file_path TEXT'
]
