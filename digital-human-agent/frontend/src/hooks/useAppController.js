import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { usePersonaStore } from '../stores/persona.js'
import { useSessionStore } from '../stores/session.js'
import { useWebSocket } from './useWebSocket.js'
import { useAudio } from './useAudio.js'
import { useConversation } from './useConversation.js'
import { useKnowledge } from './useKnowledge.js'

export function useAppController() {
  const personaStore = usePersonaStore()
  const sessionStore = useSessionStore()

  const { connect, send, sendBinary, on, connected: wsConnected } = useWebSocket()
  const audio = useAudio()
  const conversation = useConversation()
  const knowledge = useKnowledge()

  const docsOpen = ref(false)
  const toastMsg = ref('')
  const audioEl = ref(null)
  const historyLoading = ref(false)
  const pendingText = ref('')

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
        sessionStore.reset()
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

  on('session:ready', (msg) => {
    sessionStore.setSession(msg.sessionId, msg.payload?.conversationId ?? '')
    conversation.hydrateMessages(msg.payload?.history ?? [])
    historyLoading.value = false
    conversation.state.value = 'idle'
    knowledge.fetchDocuments(personaStore.selectedId)

    if (pendingText.value) {
      sendTextNow(pendingText.value)
      pendingText.value = ''
    }
  })

  on('asr:final', (msg) => {
    conversation.pushUserMessage(msg.payload.text)
  })

  on('conversation:start', (msg) => {
    conversation.state.value = 'thinking'
    conversation.startAssistantMessage(msg.turnId)
  })

  on('conversation:text_chunk', (msg) => {
    conversation.appendToken(msg.turnId, msg.payload.token)
  })

  on('conversation:done', (msg) => {
    conversation.finishAssistantMessage(msg.turnId)
    if (conversation.state.value === 'thinking') {
      conversation.state.value = 'idle'
    }
  })

  on('conversation:citations', (msg) => {
    conversation.setCitations(msg.turnId, msg.payload.citations)
  })

  on('tts:start', (msg) => {
    conversation.state.value = 'speaking'
    audio.onTtsStart(msg.turnId)
  })

  on('audio:chunk', ({ meta, audioBytes }) => {
    const frameTurnId = meta?.turnId ?? audio.activeTurnId.get()
    audio.onAudioChunk(audioBytes, frameTurnId)
  })

  on('tts:end', () => {
    audio.onTtsEnd()
    if (conversation.state.value === 'speaking') {
      conversation.state.value = 'idle'
    }
  })

  on('conversation:interrupted', (msg) => {
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

  on('error', (msg) => {
    const message = msg.payload?.message ?? '发生错误'
    if (typeof message === 'string' && message.includes('No active session')) {
      sessionStore.reset()
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

  function onSelectPersona(id) {
    if (id === personaStore.selectedId) return
    personaStore.select(id)
    conversation.clearMessages()
    sessionStore.reset()
    historyLoading.value = true
    if (!wsConnected.value) {
      showToast('连接恢复后将自动建立会话')
      return
    }
    send({ type: 'session:start', sessionId: '', payload: { personaId: id } })
  }

  function sendTextNow(text) {
    if (!sessionStore.sessionId) return
    conversation.pushUserMessageWithId(`user-${Date.now()}`, text)
    conversation.state.value = 'thinking'
    send({
      type: 'conversation:text',
      sessionId: sessionStore.sessionId,
      payload: { text },
    })
  }

  function onSendText(text) {
    const normalized = String(text ?? '').trim()
    if (!normalized) return
    if (!personaStore.selectedId) return

    if (!sessionStore.sessionId) {
      pendingText.value = normalized
      historyLoading.value = true
      if (!wsConnected.value) {
        showToast('连接中，恢复后自动发送')
        return
      }
      send({
        type: 'session:start',
        sessionId: '',
        payload: { personaId: personaStore.selectedId },
      })
      showToast('会话建立中，消息将自动发送')
      return
    }

    sendTextNow(normalized)
  }

  async function onMicDown() {
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
      await audio.startRecording()
      return
    }

    if (conversation.state.value !== 'idle') return
    conversation.state.value = 'recording'
    await audio.startRecording()
  }

  async function onMicUp() {
    if (conversation.state.value !== 'recording') return
    conversation.state.value = 'thinking'
    const buffer = await audio.stopRecording()
    sendBinary(buffer)
  }

  async function onUpload(file) {
    showToast(`上传中：${file.name}`)
    const { ok } = await knowledge.uploadDocument(personaStore.selectedId, file)
    showToast(ok ? `✓ ${file.name} 上传成功` : '上传失败，请重试')
  }

  async function onDeleteDoc(docId) {
    if (!confirm('删除后相关向量也将同步清除，确认继续？')) return
    const { ok } = await knowledge.deleteDocument(personaStore.selectedId, docId)
    if (!ok) showToast('删除失败')
  }

  async function onDeletePersona(personaId) {
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
      conversation.clearMessages()
      conversation.state.value = 'idle'
      historyLoading.value = false
      pendingText.value = ''
      knowledge.clearDocuments()
      docsOpen.value = false
    }

    showToast(`✓ 已删除「${name}」`)
  }

  let toastTimer = null
  function showToast(msg) {
    toastMsg.value = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toastMsg.value = ''
    }, 3500)
  }

  onMounted(async () => {
    audio.initAudioElement(audioEl.value)
    connect()
    await personaStore.fetchPersonas()
  })

  onUnmounted(() => {
    clearTimeout(toastTimer)
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
    onUpload,
    onDeleteDoc,
    onDeletePersona,
  }
}
