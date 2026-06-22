/**
 * @xingseq/tool-registry barrel
 *
 * - 工具定义全集与查询函数：来自 ./definitions
 * - 工具注册中心：createToolRegistry
 * - 敏感操作确认（依赖注入）：createConfirmationManager / DEFAULT_SENSITIVE_TOOLS / buildDefaultConfirmMessage
 *
 * L1（shared-utils 等）仅被本包内部使用；外部消费者通过此 barrel 或子路径 exports 访问。
 */

export {
  // 查询函数
  getToolGroupsOverview,
  getAllTools,
  getToolsByGroup,
  getToolByName,
  getToolGroups,
  // 各组定义（按需）
  fileTools,
  directoryTools,
  fileManagementTools,
  commandTools,
  databaseTools,
  aiChatTools,
  aiDrawTools,
  flowGraphTools,
  customModelTools,
  documentationTools,
  subAppTools,
  agentTools,
  searchTools,
  authorizationTools,
  timerTools,
  emailTools,
  mockEmailTools,
  zhmmTools
} from './definitions/index.js'

export { createToolRegistry } from './registry.js'
export {
  createConfirmationManager,
  DEFAULT_SENSITIVE_TOOLS,
  buildDefaultConfirmMessage
} from './confirmation.js'
