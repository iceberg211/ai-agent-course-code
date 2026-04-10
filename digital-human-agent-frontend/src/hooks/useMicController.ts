import { ref } from 'vue'
import { useSessionStore } from '../stores/session'
import { usePersonaStore } from '../stores/persona'
import { useConversation } from './useConversation'
import { useAudio } from './useAudio'

/** 按住时间少于此值视为误触 */
const MIC_MIN_HOLD_MS = 180
/** 松开后延迟此时长再发送（给用户取消机会） */
const MIC_SEND_DELAY_MS = 1000

/**
 * 麦克风控制 Hook。
 *
 * 职责：
 * - 处理「按下麦克风 / 松开麦克风」的完整状态转换
 * - 松开后缓冲 1 秒（可取消）再通过 sendBinary 发送语音
 * - 管理待发送状态（pendingVoiceSend）
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

  const pendingVoiceSend = ref(false)
  const micPressedAt = ref(0)
  let voiceSendTimer: ReturnType<typeof setTimeout> | null = null

  // ── 公开操作 ───────────────────────────────────────────────────────────────

  async function onMicDown(mode: string) {
    // 如有待发送语音，取消
    if (pendingVoiceSend.value) {
      clearPending(true)
      conversation.state.value = 'idle'
    }

    // 会话未建立时先初始化
    if (!sessionStore.sessionId) {
      if (!personaStore.selectedId) return
      if (!sessionStore.connected) {
        showToast('连接中，请稍后再试')
        return
      }
      send({
        type: 'session:start',
        sessionId: '',
        payload: { personaId: personaStore.selectedId, mode },
      })
      showToast('会话建立中，请再按一次开始说话')
      return
    }

    clearPending()

    // 打断当前播报
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
    showToast(`录音已结束，${MIC_SEND_DELAY_MS / 1000} 秒后发送`)

    voiceSendTimer = setTimeout(() => {
      voiceSendTimer = null
      pendingVoiceSend.value = false
      sendBinary(buffer)
    }, MIC_SEND_DELAY_MS)
  }

  function clearPending(showNotice = false) {
    if (voiceSendTimer) {
      clearTimeout(voiceSendTimer)
      voiceSendTimer = null
    }
    if (pendingVoiceSend.value && showNotice) {
      showToast('已取消待发送语音')
    }
    pendingVoiceSend.value = false
  }

  function dispose() {
    clearPending()
  }

  return {
    pendingVoiceSend,
    onMicDown,
    onMicUp,
    clearPending,
    dispose,
  }
}
