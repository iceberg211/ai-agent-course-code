import { ref, watch } from 'vue'
import { useSessionStore } from '@/stores/session'
import { usePersonaStore } from '@/stores/persona'
import { useConversation } from '@/hooks/useConversation'
import { useAudio } from '@/hooks/useAudio'

/** 录音时间少于此值视为误触 */
const MIC_MIN_DURATION_MS = 300

/**
 * 麦克风控制 Hook。
 *
 * 职责：
 * - 处理「点击开始录音 / 再次点击结束发送」的完整状态转换
 * - 在首次进入语音时自动建立会话，并在会话就绪后开始收音
 * - 管理待开始录音状态（preparing）
 *
 * 所有 WebSocket 发送通过依赖注入的 send/sendBinary 回调完成，保持解耦。
 */
export function useMicController(
  conversation: ReturnType<typeof useConversation>,
  audio: ReturnType<typeof useAudio>,
  send: (msg: object) => void,
  sendBinary: (buffer: ArrayBuffer) => void,
  showToast: (msg: string) => void,
) {
  const sessionStore = useSessionStore()
  const personaStore = usePersonaStore()

  const preparing = ref(false)
  const autoStartRecording = ref(false)
  const recordingStartedAt = ref(0)

  watch(
    () => sessionStore.sessionId,
    (sessionId) => {
      if (!sessionId || !autoStartRecording.value) return
      autoStartRecording.value = false
      void startRecording()
    },
  )

  watch(
    () => sessionStore.connected,
    (connected) => {
      if (connected) return
      clearPending()
    },
  )

  // ── 公开操作 ───────────────────────────────────────────────────────────────

  async function onMicToggle(mode: string) {
    if (preparing.value) {
      clearPending(true)
      return
    }

    if (conversation.state.value === 'recording') {
      await stopRecordingAndSend()
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
      conversation.state.value = 'idle'
    }

    if (conversation.state.value !== 'idle') return

    if (!(await ensureSession(mode))) return
    await startRecording()
  }

  function clearPending(showNotice = false) {
    preparing.value = false
    autoStartRecording.value = false
    if (showNotice) {
      showToast('已取消开始录音')
    }
  }

  function dispose() {
    clearPending()
    if (conversation.state.value === 'recording') {
      conversation.state.value = 'idle'
      void audio.stopRecording().catch(() => undefined)
    }
  }

  async function ensureSession(mode: string) {
    if (sessionStore.sessionId) return true
    if (!personaStore.selectedId) {
      showToast('请先选择知识助手')
      return false
    }
    if (!sessionStore.connected) {
      showToast('连接中，请稍后再试')
      return false
    }
    preparing.value = true
    autoStartRecording.value = true
    sessionStore.setHistoryLoading(true)
    send({
      type: 'session:start',
      sessionId: '',
      payload: { personaId: personaStore.selectedId, mode },
    })
    showToast('正在准备语音会话')
    return false
  }

  async function startRecording() {
    clearPending()
    conversation.state.value = 'recording'
    recordingStartedAt.value = Date.now()
    try {
      await audio.startRecording()
    } catch {
      conversation.state.value = 'idle'
      recordingStartedAt.value = 0
      showToast('无法开启麦克风，请检查浏览器权限')
    }
  }

  async function stopRecordingAndSend() {
    if (conversation.state.value !== 'recording') return

    const durationMs = Date.now() - recordingStartedAt.value
    recordingStartedAt.value = 0

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

    if (durationMs < MIC_MIN_DURATION_MS) {
      conversation.state.value = 'idle'
      showToast('录音时间太短，已取消发送')
      return
    }

    conversation.state.value = 'thinking'
    sendBinary(buffer)
    showToast('语音已发送')
  }

  return {
    preparing,
    onMicToggle,
    clearPending,
    dispose,
  }
}
