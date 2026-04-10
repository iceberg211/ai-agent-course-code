import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { usePersonaStore } from '../stores/persona'
import { useSessionStore } from '../stores/session'
import { useWebSocket } from './useWebSocket'
import { useAudio } from './useAudio'
import { useConversation } from './useConversation'
import { useKnowledge } from './useKnowledge'
import { useVoiceClone } from './useVoiceClone'
import { useDigitalHuman } from './useDigitalHuman'
import { useToast } from './useToast'
import { useTextChat } from './useTextChat'
import { useMicController } from './useMicController'
import { useWsEventHandler } from './useWsEventHandler'
import { usePersonaActions } from './usePersonaActions'
import type { VoiceCloneState } from '../types'

/**
 * 应用控制器 — 组合层。
 *
 * 职责：
 * - 组合各子 Hook，传入相互依赖关系
 * - 注册生命周期（onMounted / onUnmounted）
 * - 监听 WebSocket 连接状态，触发 session:start
 * - 向视图层暴露统一的状态和操作接口
 *
 * 本文件不包含任何业务实现细节。
 */
export function useAppController() {
  const personaStore = usePersonaStore()
  const sessionStore = useSessionStore()

  const { connect, send, sendBinary, on, connected: wsConnected } = useWebSocket()
  const audio = useAudio()
  const conversation = useConversation()
  const knowledge = useKnowledge()
  const voiceClone = useVoiceClone()
  const digitalHuman = useDigitalHuman((msg) => send(msg))

  const { toastMsg, showToast } = useToast()
  const docsOpen = ref(false)
  const historyLoading = ref(false)
  const audioEl = ref<HTMLAudioElement | null>(null)
  const digitalVideoEl = ref<HTMLVideoElement | null>(null)

  // ── 子 Hook 组合 ───────────────────────────────────────────────────────────

  const textChat = useTextChat(conversation)
  textChat.setErrorHandler(showToast)

  const mic = useMicController(
    conversation,
    audio,
    send,
    sendBinary,
    showToast,
  )

  const personaActions = usePersonaActions(
    conversation,
    knowledge,
    voiceClone,
    digitalHuman,
    textChat,
    historyLoading,
    docsOpen,
    send,
    showToast,
  )

  // WS 事件注册
  useWsEventHandler(
    {
      conversation,
      audio,
      knowledge,
      voiceClone,
      digitalHuman,
      textChat,
      mode: personaActions.mode,
      historyLoading,
    },
    on,
    showToast,
    send,
  )

  // ── WebSocket 连接状态监听 ──────────────────────────────────────────────────

  watch(
    wsConnected,
    (val) => {
      sessionStore.setConnected(!!val)

      if (!val) {
        sessionStore.setSession('', sessionStore.conversationId)
        mic.clearPending()
        void digitalHuman.close()
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
          payload: {
            personaId: personaStore.selectedId,
            mode: personaActions.mode.value,
          },
        })
      }
    },
    { immediate: true },
  )

  // 数字人视频元素绑定
  watch(digitalVideoEl, (el) => {
    digitalHuman.bindVideo(el)
  })

  // 语音克隆完成后刷新 Persona 列表
  watch(
    () => voiceClone.state.value?.status,
    (status) => {
      if (status === 'ready') void personaStore.fetchPersonas()
    },
  )

  // ── 知识库 & 语音克隆操作 ──────────────────────────────────────────────────

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

  async function onSearchKnowledge(query: string) {
    if (!personaStore.selectedId) {
      showToast('请先选择角色')
      return
    }
    const result = await knowledge.searchKnowledge(personaStore.selectedId, query)
    if (!result.ok) {
      showToast(result.message ?? '检索测试失败')
      return
    }
    const stage1Count = knowledge.searchResult.value?.stage1.length ?? 0
    const stage2Count = knowledge.searchResult.value?.stage2.length ?? 0
    showToast(`检索完成：stage1 ${stage1Count} 条，stage2 ${stage2Count} 条`)
  }

  async function onUploadVoiceSample(file: File) {
    if (!personaStore.selectedId) {
      showToast('请先选择角色')
      return
    }
    showToast(`上传语音样本：${file.name}`)
    const result = await voiceClone.uploadSample(personaStore.selectedId, file)
    if (!result.ok) {
      showToast(result.message ?? '语音克隆发起失败')
      return
    }
    showToast('语音克隆任务已提交，正在训练')
  }

  async function onRefreshVoiceCloneStatus() {
    if (!personaStore.selectedId) return
    const result = await voiceClone.fetchStatus(personaStore.selectedId)
    if (!result.ok) {
      showToast(result.message ?? '查询语音克隆状态失败')
    }
  }

  async function onSendText(text: string) {
    const normalized = String(text ?? '').trim()
    if (!normalized || !personaStore.selectedId) return

    mic.clearPending()

    if (
      conversation.state.value === 'thinking' ||
      conversation.state.value === 'speaking'
    ) {
      if (sessionStore.sessionId) {
        send({ type: 'conversation:interrupt', sessionId: sessionStore.sessionId })
      }
      audio.stopPlayback()
    }

    try {
      await textChat.sendText(normalized)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '发送失败')
    }
  }

  async function onStopText() {
    await textChat.stopText()
    showToast('已停止生成')
  }

  // ── 生命周期 ───────────────────────────────────────────────────────────────

  onMounted(async () => {
    audio.initAudioElement(audioEl.value)
    digitalHuman.bindVideo(digitalVideoEl.value)
    connect()
    await personaStore.fetchPersonas()
  })

  onUnmounted(() => {
    mic.dispose()
    textChat.reset()
    void digitalHuman.close()
    voiceClone.stopPolling()
  })

  // ── 暴露给视图的接口 ───────────────────────────────────────────────────────

  return {
    // stores
    personaStore,
    sessionStore,
    // UI 状态
    docsOpen,
    mode: personaActions.mode,
    toastMsg,
    audioEl,
    digitalVideoEl,
    historyLoading,
    // 对话
    messages: computed(() => conversation.messages.value),
    state: computed(() => conversation.state.value),
    // 知识库
    documents: computed(() => knowledge.documents.value),
    uploading: computed(() => knowledge.uploading.value),
    knowledgeLoading: computed(() => knowledge.loading.value),
    knowledgeSearching: computed(() => knowledge.searching.value),
    knowledgeSearchResult: computed(() => knowledge.searchResult.value),
    knowledge,
    // 语音克隆
    voiceCloneState: computed<VoiceCloneState | null>(() => voiceClone.state.value),
    voiceCloneLoading: computed(() => voiceClone.loading.value),
    voiceCloneUploading: computed(() => voiceClone.uploading.value),
    // 数字人
    digitalHumanStatus: computed(() => digitalHuman.status.value),
    digitalHumanError: computed(() => digitalHuman.lastError.value),
    // 操作
    onSelectPersona: personaActions.onSelectPersona,
    onChangeMode: personaActions.onChangeMode,
    onDeletePersona: personaActions.onDeletePersona,
    onMicDown: mic.onMicDown,
    onMicUp: mic.onMicUp,
    onSendText,
    onStopText,
    onUpload,
    onDeleteDoc,
    onSearchKnowledge,
    onUploadVoiceSample,
    onRefreshVoiceCloneStatus,
  }
}
