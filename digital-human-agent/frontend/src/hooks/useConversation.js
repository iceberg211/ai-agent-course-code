import { ref, nextTick } from 'vue'

/**
 * 对话状态机 + 消息列表
 * 状态流转：idle → recording → thinking → speaking → idle
 */
export function useConversation() {
  // 状态机
  const state = ref('idle') // idle | recording | thinking | speaking | closed

  // 消息列表
  const messages = ref([])

  // 滚动容器引用（由父组件传入）
  const messagesEl = ref(null)

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

  function pushUserMessage(content) {
    messages.value.push({
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      citations: [],
      streaming: false,
    })
    scrollToBottom()
  }

  function startAssistantMessage(turnId) {
    messages.value.push({
      id: turnId,
      role: 'assistant',
      content: '',
      citations: [],
      streaming: true,
    })
    scrollToBottom()
  }

  function appendToken(turnId, token) {
    const msg = messages.value.find((m) => m.id === turnId)
    if (msg) {
      msg.content += token
      scrollToBottom()
    }
  }

  function finishAssistantMessage(turnId) {
    const msg = messages.value.find((m) => m.id === turnId)
    if (msg) msg.streaming = false
  }

  function setCitations(turnId, citations) {
    const msg = messages.value.find((m) => m.id === turnId)
    if (msg) msg.citations = citations
  }

  function clearMessages() {
    messages.value = []
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
    startAssistantMessage,
    appendToken,
    finishAssistantMessage,
    setCitations,
    clearMessages,
    scrollToBottom,
  }
}
