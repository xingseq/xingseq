/**
 * @xingseq/memory-store barrel
 *
 * L2 领域：对话索引 / 完整对话文件 / 分岔路径 / 通知消息 / 主应用记忆
 *
 * 子路径 exports（按需引入）：
 *   @xingseq/memory-store/conversationManager
 *   @xingseq/memory-store/forkPathManager
 *   @xingseq/memory-store/fileStorage
 *   @xingseq/memory-store/messageStorage
 *   @xingseq/memory-store/mainMemoryService
 */

// ── 对话索引管理 ─────────────────────────────────────────────────────────────
export { getConversationFactory } from './conversationManager.js'

// ── 分岔路径管理 ─────────────────────────────────────────────────────────────
export { getForkPathFactory } from './forkPathManager.js'

// ── 完整对话文件存取 ──────────────────────────────────────────────────────────
export {
  saveDeepSeekData,
  loadConversation,
  clearAllData,
  cleanupOldDeletedConversations
} from './fileStorage.js'

// ── 通知消息 ─────────────────────────────────────────────────────────────────
export {
  getMessageFilePath,
  addMessage,
  getMessages,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteMessage,
  clearAll as clearAllMessages,
  getRechargeUrl
} from './messageStorage.js'

// ── 主应用记忆 ────────────────────────────────────────────────────────────────
export {
  MEMORY_TYPES,
  PRIORITY,
  getAllMemories,
  addMemory,
  addMemories,
  updateMemory,
  deleteMemory,
  retrieveMemories,
  buildMemoryExtractionPrompt,
  parseAndSaveMemories,
  __resetMemoriesPath
} from './mainMemoryService.js'
