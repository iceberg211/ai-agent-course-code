import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { usePersonaStore } from '../stores/persona'
import { useSessionStore } from '../stores/session'
import { useWebSocket } from './useWebSocket'
import { useAudio } from './useAudio'
import { useConversation } from './useConversation'
import { useKnowledge } from './useKnowledge'
import type { ChatMessage, Citation, MessageStatus, WsEnvelope } from '../types'

interface SessionReadyPayload {
  conversationId?: string
  history?: Array<Record<string, unknown>>
}

interface BaseWsMessage<T = Record<string, unknown>> extends WsEnvelope<T> {
  payload?: T
}

interface StreamMetadata {
  conversationId?: string
  turnId?: string
  status?: MessageStatus | 'streaming'
  citations?: Citation[]
}

type StreamUIMessage = UIMessage<StreamMetadata>

export function useAppController() {
  const MIC_SEND_DELAY_MS = 1000
  const MIC_MIN_HOLD_MS = 180

  const personaStore = usePersonaStore()
  const sessionStore = useSessionStore()

  const { connect, send, sendBinary, on, connected: wsConnected } = useWebSocket()
  const audio = useAudio()
  const conversation = useConversation()
  const knowledge = useKnowledge()

  const docsOpen = ref(false)
  const toastMsg = ref('')
  const audioEl = ref<HTMLAudioElement | null>(null)
  const historyLoading = ref(false)
  const pendingVoiceSend = ref(false)
  const micPressedAt = ref(0)
  const textRequestActive = ref(false)
  let voiceSendTimer: ReturnType<typeof setTimeout> | null = null

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
      syncMessagesFromTextChat()
      if (conversation.state.value === 'thinking') {
        conversation.state.value = 'idle'
      }
    },
    onError: (error) => {
      textRequestActive.value = false
      showToast(`⚠ 文本对话失败：${error.message}`)
      if (conversation.state.value === 'thinking') {
        conversation.state.value = 'idle'
      }
    },
  })

  const messages = computed(() => conversation.messages.value)
  const state = computed(() => conversation.state.value)
  const documents = computed(() => knowledge.documents.value)
  const uploading = computed(() => knowledge.uploading.value)
  const knowledgeLoading = computed(() => knowledge.loading.value)

  watch(
    wsConnected,
    (val) => {
      sessionStore.setConnected(!!val)

      if (!val) {
        sessionStore.setSession('', sessionStore.conversationId)
        clearPendingVoiceSend()
        if (conversation.state.value !== 'recording') {
          conversation.state.value = 'idle'
        }
        historyLoading.value = false
        return
      }

      if (personaStore.selectedId) {
        historyLoading.value = true
        send({
          type: 'session:start',
          sessionId: '',
          payload: { personaId: personaStore.selectedId },
        })
      }
    },
    { immediate: true },
  )

  watch(
    () => textChat.status,
    (chatStatus) => {
      if (chatStatus === 'submitted' || chatStatus === 'streaming') {
        textRequestActive.value = true
        if (conversation.state.value !== 'recording' && conversation.state.value !== 'speaking') {
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

  watchEffect(() => {
    // 读取 messages 以建立响应依赖
    void textChat.messages.length
    syncMessagesFromTextChat()
  })

  on('session:ready', (msg: BaseWsMessage<SessionReadyPayload>) => {
    sessionStore.setSession(msg.sessionId, msg.payload?.conversationId ?? '')
    conversation.hydrateMessages(msg.payload?.history ?? [])
    textChat.messages = []
    textRequestActive.value = false
    historyLoading.value = false
    conversation.state.value = 'idle'
    knowledge.fetchDocuments(personaStore.selectedId)
  })

  on('asr:final', (msg: BaseWsMessage<{ text?: string }>) => {
    const text = typeof msg.payload?.text === 'string' ? msg.payload.text.trim() : ''
    if (text) {
      conversation.pushUserMessage(text)
    }
  })

  on('conversation:start', (msg: BaseWsMessage) => {
    conversation.state.value = 'thinking'
    conversation.startAssistantMessage(msg.turnId ?? '')
  })

  on('conversation:text_chunk', (msg: BaseWsMessage<{ token?: string }>) => {
    conversation.appendToken(msg.turnId ?? '', msg.payload?.token ?? '')
  })

  on('conversation:done', (msg: BaseWsMessage) => {
    conversation.finishAssistantMessage(msg.turnId ?? '')
    if (conversation.state.value === 'thinking' && !textRequestActive.value) {
      conversation.state.value = 'idle'
    }
  })

  on('conversation:citations', (msg: BaseWsMessage<{ citations?: Citation[] }>) => {
    conversation.setCitations(msg.turnId ?? '', msg.payload?.citations ?? [])
  })

  on('tts:start', (msg: BaseWsMessage) => {
    conversation.state.value = 'speaking'
    audio.onTtsStart(msg.turnId ?? '')
  })

  on('audio:chunk', ({ meta, audioBytes }: { meta: { turnId?: string } | null; audioBytes: ArrayBuffer }) => {
    const frameTurnId = meta?.turnId ?? audio.activeTurnId.get()
    audio.onAudioChunk(audioBytes, frameTurnId)
  })

  on('tts:end', () => {
    audio.onTtsEnd()
    if (conversation.state.value === 'speaking') {
      conversation.state.value = 'idle'
    }
  })

  on('conversation:interrupted', (msg: BaseWsMessage) => {
    clearPendingVoiceSend()
    if (msg.turnId) {
      conversation.finishAssistantMessage(msg.turnId)
    }
    audio.stopPlayback()
    if (
      conversation.state.value === 'thinking' ||
      conversation.state.value === 'speaking'
    ) {
      conversation.state.value = 'idle'
    }
  })

  on('error', (msg: BaseWsMessage<{ message?: string }>) => {
    clearPendingVoiceSend()
    const message = msg.payload?.message ?? '发生错误'
    if (typeof message === 'string' && message.includes('No active session')) {
      sessionStore.setSession('', sessionStore.conversationId)
      if (personaStore.selectedId && wsConnected.value) {
        send({
          type: 'session:start',
          sessionId: '',
          payload: { personaId: personaStore.selectedId },
        })
      }
      showToast('会话已失效，正在自动恢复')
      conversation.state.value = 'idle'
      historyLoading.value = false
      return
    }

    showToast('⚠ ' + message)
    conversation.state.value = 'idle'
    historyLoading.value = false
  })

  function onSelectPersona(id: string) {
    if (id === personaStore.selectedId) return
    clearPendingVoiceSend()
    textRequestActive.value = false
    void textChat.stop().catch(() => undefined)
    textChat.messages = []

    personaStore.select(id)
    conversation.clearMessages()
    sessionStore.reset()
    historyLoading.value = true
    if (!wsConnected.value) {
      showToast('连接恢复后将自动建立语音会话')
      return
    }
    send({ type: 'session:start', sessionId: '', payload: { personaId: id } })
  }

  async function onSendText(text: string) {
    const normalized = String(text ?? '').trim()
    if (!normalized) return
    if (!personaStore.selectedId) return

    clearPendingVoiceSend()

    if (conversation.state.value === 'thinking' || conversation.state.value === 'speaking') {
      if (sessionStore.sessionId) {
        send({
          type: 'conversation:interrupt',
          sessionId: sessionStore.sessionId,
        })
      }
      audio.stopPlayback()
    }

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
      syncMessagesFromTextChat()
    } catch {
      textRequestActive.value = false
      if (conversation.state.value === 'thinking') {
        conversation.state.value = 'idle'
      }
      showToast('文本发送失败，请重试')
    }
  }

  async function onStopText() {
    if (textChat.status !== 'submitted' && textChat.status !== 'streaming') {
      return
    }
    await textChat.stop()
    textRequestActive.value = false
    if (conversation.state.value === 'thinking') {
      conversation.state.value = 'idle'
    }
    showToast('已停止生成')
  }

  async function onMicDown() {
    if (pendingVoiceSend.value) {
      clearPendingVoiceSend(true)
      conversation.state.value = 'idle'
    }

    if (!sessionStore.sessionId) {
      if (!personaStore.selectedId) return
      if (!wsConnected.value) {
        showToast('连接中，请稍后再试')
        return
      }
      send({
        type: 'session:start',
        sessionId: '',
        payload: { personaId: personaStore.selectedId },
      })
      historyLoading.value = true
      showToast('会话建立中，请再按一次开始说话')
      return
    }

    clearPendingVoiceSend()

    if (
      conversation.state.value === 'thinking' ||
      conversation.state.value === 'speaking'
    ) {
      send({
        type: 'conversation:interrupt',
        sessionId: sessionStore.sessionId,
      })
      audio.stopPlayback()
      conversation.state.value = 'recording'
      micPressedAt.value = Date.now()
      try {
        await audio.startRecording()
      } catch {
        conversation.state.value = 'idle'
        showToast('无法开启麦克风，请检查浏览器权限')
      }
      return
    }

    if (conversation.state.value !== 'idle') return
    conversation.state.value = 'recording'
    micPressedAt.value = Date.now()
    try {
      await audio.startRecording()
    } catch {
      conversation.state.value = 'idle'
      showToast('无法开启麦克风，请检查浏览器权限')
    }
  }

  async function onMicUp() {
    if (conversation.state.value !== 'recording') return
    const holdMs = Date.now() - micPressedAt.value
    micPressedAt.value = 0

    let buffer: ArrayBuffer
    try {
      buffer = await audio.stopRecording()
    } catch {
      conversation.state.value = 'idle'
      showToast('录音失败，请重试')
      return
    }

    if (!buffer || buffer.byteLength === 0) {
      conversation.state.value = 'idle'
      showToast('未检测到有效语音，已取消发送')
      return
    }

    if (holdMs < MIC_MIN_HOLD_MS) {
      conversation.state.value = 'idle'
      showToast('按住时间太短，已取消发送')
      return
    }

    conversation.state.value = 'thinking'
    pendingVoiceSend.value = true
    showToast('录音已结束，1 秒后发送')
    voiceSendTimer = setTimeout(() => {
      voiceSendTimer = null
      pendingVoiceSend.value = false
      sendBinary(buffer)
    }, MIC_SEND_DELAY_MS)
  }

  async function onUpload(file: File) {
    showToast(`上传中：${file.name}`)
    const { ok } = await knowledge.uploadDocument(personaStore.selectedId, file)
    showToast(ok ? `✓ ${file.name} 上传成功` : '上传失败，请重试')
  }

  async function onDeleteDoc(docId: string) {
    if (!confirm('删除后相关向量也将同步清除，确认继续？')) return
    const { ok } = await knowledge.deleteDocument(personaStore.selectedId, docId)
    if (!ok) showToast('删除失败')
  }

  async function onDeletePersona(personaId: string) {
    const target = personaStore.personas.find((p) => p.id === personaId)
    const name = target?.name ?? '该角色'
    if (!confirm(`确认删除「${name}」？其对话与知识库会一并删除。`)) return

    const deletingSelected = personaStore.selectedId === personaId
    if (deletingSelected && sessionStore.sessionId) {
      send({
        type: 'conversation:interrupt',
        sessionId: sessionStore.sessionId,
      })
    }

    const { ok } = await personaStore.deletePersona(personaId)
    if (!ok) {
      showToast(`删除「${name}」失败`)
      return
    }

    if (deletingSelected) {
      sessionStore.reset()
      clearPendingVoiceSend()
      textRequestActive.value = false
      void textChat.stop().catch(() => undefined)
      textChat.messages = []
      conversation.clearMessages()
      conversation.state.value = 'idle'
      historyLoading.value = false
      knowledge.clearDocuments()
      docsOpen.value = false
    }

    showToast(`✓ 已删除「${name}」`)
  }

  let toastTimer: ReturnType<typeof setTimeout> | null = null
  function showToast(msg: string) {
    toastMsg.value = msg
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toastMsg.value = ''
    }, 3500)
  }

  function clearPendingVoiceSend(showNotice = false) {
    if (voiceSendTimer) {
      clearTimeout(voiceSendTimer)
      voiceSendTimer = null
    }
    if (pendingVoiceSend.value && showNotice) {
      showToast('已取消待发送语音')
    }
    pendingVoiceSend.value = false
  }

  function syncMessagesFromTextChat() {
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

    conversation.scrollToBottom()
  }

  function mapSdkMessage(message: StreamUIMessage): ChatMessage {
    const content = (message.parts ?? [])
      .map((part) => {
        if (part.type !== 'text') return ''
        return typeof part.text === 'string' ? part.text : ''
      })
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
      citations,
      streaming,
      turnId: message.metadata?.turnId,
    }
  }

  function normalizeMessageStatus(status: unknown): MessageStatus {
    if (status === 'interrupted') return 'interrupted'
    if (status === 'failed') return 'failed'
    return 'completed'
  }

  onMounted(async () => {
    audio.initAudioElement(audioEl.value)
    connect()
    await personaStore.fetchPersonas()
  })

  onUnmounted(() => {
    clearPendingVoiceSend()
    void textChat.stop().catch(() => undefined)
    if (toastTimer) clearTimeout(toastTimer)
  })

  return {
    personaStore,
    sessionStore,
    docsOpen,
    toastMsg,
    audioEl,
    messages,
    state,
    historyLoading,
    documents,
    uploading,
    knowledgeLoading,
    knowledge,
    onSelectPersona,
    onMicDown,
    onMicUp,
    onSendText,
    onStopText,
    onUpload,
    onDeleteDoc,
    onDeletePersona,
  }
}
