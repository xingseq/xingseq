/** SSE 事件回调类型 */
export interface ChatEvent {
  event: string
  data: any
}

export interface ChatParams {
  workspacePath?: string
  workspace?: string
  conversationId: string
  message: string
  onEvent: (e: ChatEvent) => void
  signal?: AbortSignal
}
