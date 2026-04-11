import { onMounted, onUnmounted, watch } from 'vue'
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

/**
 * 应用生命周期协调器（Orchestrator）。
 *
 * 职责仅限于：
 * 1. 组合所有子 Hook 并注入相互依赖
 * 2. 注册 onMounted / onUnmounted
 * 3. 监听 WebSocket 连接状态，触发 session:start
 *
 * ✅ 不再暴露大量状态值——消费方（App.vue 及子组件）改为各自直接
 *    调用对应的 store / hook 取数据，本 hook 只返回"需要跨组件共享的操作句柄"。
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

  const textChat = useTextChat(conversation)
  textChat.setErrorHandler(showToast)

  const mic = useMicController(conversation, audio, send, sendBinary, showToast)

  const { mode, onSelectPersona, onDeletePersona, onChangeMode } = usePersonaActions(
    conversation, knowledge, voiceClone, digitalHuman, textChat, send, showToast,
  )

  useWsEventHandler(
    { conversation, audio, knowledge, voiceClone, digitalHuman, textChat, mode },
    on, showToast, send,
  )

  // ── WebSocket 连接监听 ────────────────────────────────────────────────────

  watch(wsConnected, (val) => {
    sessionStore.setConnected(!!val)
    if (!val) {
      sessionStore.setSession('', sessionStore.conversationId)
      sessionStore.setHistoryLoading(false)
      mic.clearPending()
      void digitalHuman.close()
      if (conversation.state.value !== 'recording') conversation.state.value = 'idle'
      return
    }
    if (personaStore.selectedId) {
      sessionStore.setHistoryLoading(true)
      send({
        type: 'session:start',
        sessionId: '',
        payload: { personaId: personaStore.selectedId, mode: mode.value },
      })
    }
  }, { immediate: true })

  watch(
    () => voiceClone.state.value?.status,
    (status) => { if (status === 'ready') void personaStore.fetchPersonas() },
  )

  // ── 生命周期 ──────────────────────────────────────────────────────────────

  onMounted(async () => {
    connect()
    await personaStore.fetchPersonas()
  })

  onUnmounted(() => {
    mic.dispose()
    textChat.reset()
    void digitalHuman.close()
    voiceClone.stopPolling()
  })

  // ── 暴露：操作句柄 + 渲染状态（确保全局只使用这一套 Hook 实例） ─────────────

  return {
    // 操作（子组件 emit 到 App.vue，App.vue 调用这些）
    onSelectPersona,
    onDeletePersona,
    onChangeMode,
    onMicDown: (mode_: string) => mic.onMicDown(mode_),
    onMicUp: mic.onMicUp,
    onSendText: async (text: string) => {
      const normalized = String(text ?? '').trim()
      if (!normalized || !personaStore.selectedId) return
      mic.clearPending()
      if (conversation.state.value === 'thinking' || conversation.state.value === 'speaking') {
        if (sessionStore.sessionId) send({ type: 'conversation:interrupt', sessionId: sessionStore.sessionId })
        audio.stopPlayback()
      }
      try {
        await textChat.sendText(normalized)
      } catch (err) {
        showToast(err instanceof Error ? err.message : '发送失败')
      }
    },
    onStopText: async () => {
      await textChat.stopText()
      showToast('已停止生成')
    },
    onUpload: async (file: File) => {
      showToast(`上传中：${file.name}`)
      const { ok } = await knowledge.uploadDocument(personaStore.selectedId, file)
      showToast(ok ? `✓ ${file.name} 上传成功` : '上传失败，请重试')
    },
    onDeleteDoc: async (docId: string) => {
      if (!confirm('删除后相关向量也将同步清除，确认继续？')) return
      const { ok } = await knowledge.deleteDocument(personaStore.selectedId, docId)
      if (!ok) showToast('删除失败')
    },
    onSearchKnowledge: async (query: string) => {
      if (!personaStore.selectedId) { showToast('请先选择角色'); return }
      const result = await knowledge.searchKnowledge(personaStore.selectedId, query)
      if (!result.ok) { showToast(result.message ?? '检索测试失败'); return }
      const s1 = knowledge.searchResult.value?.stage1.length ?? 0
      const s2 = knowledge.searchResult.value?.stage2.length ?? 0
      showToast(`检索完成：stage1 ${s1} 条，stage2 ${s2} 条`)
    },
    onUploadVoiceSample: async (file: File) => {
      if (!personaStore.selectedId) { showToast('请先选择角色'); return }
      showToast(`上传语音样本：${file.name}`)
      const result = await voiceClone.uploadSample(personaStore.selectedId, file)
      if (!result.ok) { showToast(result.message ?? '语音克隆发起失败'); return }
      showToast('语音克隆任务已提交，正在训练')
    },
    onRefreshVoiceCloneStatus: async () => {
      if (!personaStore.selectedId) return
      const result = await voiceClone.fetchStatus(personaStore.selectedId)
      if (!result.ok) showToast(result.message ?? '查询语音克隆状态失败')
    },
    // 状态对象（App.vue 直接渲染，避免重复创建 useConversation/useKnowledge/useToast）
    conversation,
    knowledge,
    voiceClone,
    toastMsg,
    // 需要在 App.vue 模板中 ref 绑定的 hook 实例
    audio,
    digitalHuman,
    mode,
  }
}
