import { ref, nextTick } from 'vue'
import type { ChatMessage, Citation, ConversationState, MessageRole, MessageStatus } from '../types'

interface HistoryMessage {
  id?: string
  turnId?: string
  role?: MessageRole
  content?: string
  status?: MessageStatus
}

/**
 * 对话状态机 + 消息列表
 * 状态流转：idle → recording → thinking → speaking → idle
 */
export function useConversation() {
  // 状态机
  const state = ref<ConversationState>('idle')

  // 消息列表
  const messages = ref<ChatMessage[]>([])

  // 滚动容器引用（由父组件传入）
  const messagesEl = ref<HTMLElement | null>(null)

  // ── 状态计算 ──────────────────────────────────────────────────────
  const stateLabel = {
    idle:      '待命',
    recording: '录音中...',
    thinking:  '思考中',
    speaking:  '播报中',
    closed:    '已结束',
  }

  const micHint = {
    idle:      '按住说话',
    recording: '松开发送',
    thinking:  '点击打断',
    speaking:  '点击打断',
    closed:    '',
  }

  // ── 消息操作 ──────────────────────────────────────────────────────

  function pushUserMessage(content: string) {
    messages.value.push({
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      status: 'completed',
      citations: [],
      streaming: false,
    })
    scrollToBottom()
  }

  function pushUserMessageWithId(id: string, content: string) {
    messages.value.push({
      id: id || `user-${Date.now()}`,
      role: 'user',
      content,
      status: 'completed',
      citations: [],
      streaming: false,
    })
    scrollToBottom()
  }

  function startAssistantMessage(turnId: string) {
    messages.value.push({
      id: turnId,
      role: 'assistant',
      content: '',
      status: 'completed',
      citations: [],
      streaming: true,
    })
    scrollToBottom()
  }

  function appendToken(turnId: string, token: string) {
    const msg = messages.value.find((m) => m.id === turnId)
    if (msg) {
      msg.content += token
      scrollToBottom()
    }
  }

  function finishAssistantMessage(turnId: string) {
    const msg = messages.value.find((m) => m.id === turnId)
    if (msg) msg.streaming = false
  }

  function setCitations(turnId: string, citations: Citation[]) {
    const msg = messages.value.find((m) => m.id === turnId)
    if (msg) msg.citations = citations
  }

  function clearMessages() {
    messages.value = []
  }

  function hydrateMessages(history: HistoryMessage[] = []) {
    messages.value = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m, idx) => ({
        id: m.id ?? `${m.turnId}-${m.role}-${idx}`,
        role: m.role,
        content: m.content ?? '',
        status: m.status ?? 'completed',
        citations: [],
        streaming: false,
      }))
    scrollToBottom()
  }

  // ── 工具 ──────────────────────────────────────────────────────────

  function scrollToBottom() {
    nextTick(() => {
      if (messagesEl.value)
        messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    })
  }

  return {
    state,
    messages,
    messagesEl,
    stateLabel,
    micHint,
    pushUserMessage,
    pushUserMessageWithId,
    startAssistantMessage,
    appendToken,
    finishAssistantMessage,
    setCitations,
    clearMessages,
    hydrateMessages,
    scrollToBottom,
  }
}
