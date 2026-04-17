import { ref, watch, watchEffect } from 'vue'
import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { usePersonaStore } from '../stores/persona'
import { useSessionStore } from '../stores/session'
import { useConversation } from './useConversation'
import { useCitationResolver } from './useCitationResolver'
import type { ChatMessage, Citation, MessageStatus, StreamMetadata } from '../types'


type StreamUIMessage = UIMessage<StreamMetadata>

/**
 * 文字聊天 Hook。
 *
 * 职责：
 * - 管理 `@ai-sdk/vue` Chat 实例
 * - 监听 Chat 状态变化，同步 conversation.state
 * - 将 SDK 消息格式转换为 ChatMessage 并同步到 conversation
 *
 * 返回 textChat 实例和 textRequestActive 供外部（useMicController 等）感知。
 */
export function useTextChat(conversation: ReturnType<typeof useConversation>) {
  const personaStore = usePersonaStore()
  const sessionStore = useSessionStore()
  const citationResolver = useCitationResolver()

  const textRequestActive = ref(false)
  const resolvingCitations = ref(false)

  const textChat = new Chat<StreamUIMessage>({
    transport: new DefaultChatTransport<StreamUIMessage>({
      api: '/api/chat',
      body: () => ({
        personaId: personaStore.selectedId,
        conversationId: sessionStore.conversationId || undefined,
      }),
    }),
    onFinish: ({ message }) => {
      textRequestActive.value = false
      const meta = message.metadata
      if (meta?.conversationId) {
        sessionStore.setSession(sessionStore.sessionId, meta.conversationId)
      }
      syncMessages()
      if (conversation.state.value === 'thinking') {
        conversation.state.value = 'idle'
      }
    },
    onError: (error) => {
      textRequestActive.value = false
      if (conversation.state.value === 'thinking') {
        conversation.state.value = 'idle'
      }
      // 错误消息由调用方通过返回的 onError 回调处理
      _onError(`⚠ 文本对话失败：${error.message}`)
    },
  })

  // 外部注册错误回调（避免循环依赖 useToast）
  let _onError: (msg: string) => void = () => {}
  function setErrorHandler(handler: (msg: string) => void) {
    _onError = handler
  }

  // 监听 Chat 状态 → 同步 conversation.state
  watch(
    () => textChat.status,
    (chatStatus) => {
      if (chatStatus === 'submitted' || chatStatus === 'streaming') {
        textRequestActive.value = true
        if (
          conversation.state.value !== 'recording' &&
          conversation.state.value !== 'speaking'
        ) {
          conversation.state.value = 'thinking'
        }
        return
      }
      if (chatStatus === 'ready' && textRequestActive.value) {
        textRequestActive.value = false
        if (conversation.state.value === 'thinking') {
          conversation.state.value = 'idle'
        }
      }
    },
    { immediate: true },
  )

  // 消息变化时自动同步
  watchEffect(() => {
    void textChat.messages.length
    syncMessages()
  })

  // ── 私有工具 ───────────────────────────────────────────────────────────────

  function syncMessages() {
    const sdkMessages = textChat.messages.filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    )
    for (const message of sdkMessages) {
      const mapped = mapSdkMessage(message)
      const idx = conversation.messages.value.findIndex((m) => m.id === mapped.id)
      if (idx >= 0) {
        conversation.messages.value[idx] = mapped
      } else {
        conversation.messages.value.push(mapped)
      }
    }
    void resolvePendingCitationNames()
    conversation.scrollToBottom()
  }

  function mapSdkMessage(message: StreamUIMessage): ChatMessage {
    const content = (message.parts ?? [])
      .map((part) => (part.type !== 'text' ? '' : (typeof part.text === 'string' ? part.text : '')))
      .join('')

    const citations = Array.isArray(message.metadata?.citations)
      ? message.metadata.citations.filter(
          (item): item is Citation => typeof item === 'object' && item !== null,
        )
      : []

    const streaming =
      message.role === 'assistant' &&
      (message.parts ?? []).some(
        (part) => part.type === 'text' && part.state === 'streaming',
      )

    const status = normalizeMessageStatus(message.metadata?.status)

    return {
      id: message.id,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content,
      status,
      citations: citationResolver.applyCached(personaStore.selectedId, citations),
      streaming,
      turnId: message.metadata?.turnId,
    }
  }

  async function resolvePendingCitationNames() {
    if (resolvingCitations.value || !personaStore.selectedId) return
    const targets = conversation.messages.value.filter((message) =>
      message.citations.some(citationResolver.hasMissingKnowledgeBaseName),
    )
    if (!targets.length) return

    resolvingCitations.value = true
    try {
      const resolved = await Promise.all(
        targets.map(async (message) => ({
          id: message.id,
          citations: await citationResolver.resolve(
            personaStore.selectedId,
            message.citations,
          ),
        })),
      )

      for (const item of resolved) {
        const target = conversation.messages.value.find((message) => message.id === item.id)
        if (target) target.citations = item.citations
      }
    } finally {
      resolvingCitations.value = false
    }
  }

  function normalizeMessageStatus(status: unknown): MessageStatus {
    if (status === 'interrupted') return 'interrupted'
    if (status === 'failed') return 'failed'
    return 'completed'
  }

  // ── 公开操作 ───────────────────────────────────────────────────────────────

  async function sendText(text: string): Promise<void> {
    const normalized = String(text ?? '').trim()
    if (!normalized) return

    textRequestActive.value = true
    conversation.state.value = 'thinking'

    try {
      await textChat.sendMessage(
        { text: normalized },
        {
          body: {
            personaId: personaStore.selectedId,
            conversationId: sessionStore.conversationId || undefined,
          },
        },
      )
      syncMessages()
    } catch {
      textRequestActive.value = false
      if (conversation.state.value === 'thinking') {
        conversation.state.value = 'idle'
      }
      throw new Error('文本发送失败，请重试')
    }
  }

  async function stopText(): Promise<void> {
    if (textChat.status !== 'submitted' && textChat.status !== 'streaming') return
    await textChat.stop()
    textRequestActive.value = false
    if (conversation.state.value === 'thinking') {
      conversation.state.value = 'idle'
    }
  }

  function reset() {
    textRequestActive.value = false
    void textChat.stop().catch(() => undefined)
    textChat.messages = []
  }

  return {
    textChat,
    textRequestActive,
    setErrorHandler,
    sendText,
    stopText,
    reset,
    syncMessages,
  }
}
