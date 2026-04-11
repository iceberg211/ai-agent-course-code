import { useSessionStore } from '../stores/session'
import { usePersonaStore } from '../stores/persona'
import { useConversation } from './useConversation'
import { useAudio } from './useAudio'
import { useKnowledge } from './useKnowledge'
import { useVoiceClone } from './useVoiceClone'
import { useDigitalHuman } from './useDigitalHuman'
import { useTextChat } from './useTextChat'
import type { Citation } from '../types'

type BaseWsMessage<T = Record<string, unknown>> = {
  type: string
  sessionId?: string
  turnId?: string
  payload?: T
}

/**
 * WS 事件处理 Hook。
 *
 * 职责：集中注册所有 WebSocket `on(type, handler)` 监听。
 *
 * historyLoading 改为直接操作 sessionStore，无需外部注入。
 */
export function useWsEventHandler(
  {
    conversation,
    audio,
    knowledge,
    voiceClone,
    digitalHuman,
    textChat,
    mode,
  }: {
    conversation: ReturnType<typeof useConversation>
    audio: ReturnType<typeof useAudio>
    knowledge: ReturnType<typeof useKnowledge>
    voiceClone: ReturnType<typeof useVoiceClone>
    digitalHuman: ReturnType<typeof useDigitalHuman>
    textChat: ReturnType<typeof useTextChat>
    mode: { value: string }
  },
  on: <T>(type: string, handler: (msg: any) => void) => void,
  showToast: (msg: string) => void,
  send: (msg: object) => void,
) {
  const sessionStore = useSessionStore()
  const personaStore = usePersonaStore()

  // ── session:ready ──────────────────────────────────────────────────────────
  on('session:ready', (msg: BaseWsMessage<{
    conversationId?: string
    history?: Array<Record<string, unknown>>
    mode?: string
  }>) => {
    if (msg.payload?.mode) {
      mode.value = msg.payload.mode
      if (mode.value !== 'digital-human') void digitalHuman.close()
    }
    sessionStore.setSession(msg.sessionId ?? '', msg.payload?.conversationId ?? '')
    conversation.hydrateMessages(msg.payload?.history ?? [])
    textChat.reset()
    sessionStore.setHistoryLoading(false)
    conversation.state.value = 'idle'
    knowledge.fetchDocuments(personaStore.selectedId)
    void voiceClone.fetchStatus(personaStore.selectedId)
  })

  // ── asr:final ──────────────────────────────────────────────────────────────
  on('asr:final', (msg: BaseWsMessage<{ text?: string }>) => {
    const text = typeof msg.payload?.text === 'string' ? msg.payload.text.trim() : ''
    if (text) conversation.pushUserMessage(text)
  })

  // ── conversation:start ─────────────────────────────────────────────────────
  on('conversation:start', (msg: BaseWsMessage) => {
    conversation.state.value = 'thinking'
    conversation.startAssistantMessage(msg.turnId ?? '')
  })

  // ── conversation:text_chunk ────────────────────────────────────────────────
  on('conversation:text_chunk', (msg: BaseWsMessage<{ token?: string }>) => {
    conversation.appendToken(msg.turnId ?? '', msg.payload?.token ?? '')
  })

  // ── conversation:done ──────────────────────────────────────────────────────
  on('conversation:done', (msg: BaseWsMessage) => {
    conversation.finishAssistantMessage(msg.turnId ?? '')
    if (conversation.state.value === 'thinking' && !textChat.textRequestActive.value) {
      conversation.state.value = 'idle'
    }
  })

  // ── conversation:citations ─────────────────────────────────────────────────
  on('conversation:citations', (msg: BaseWsMessage<{ citations?: Citation[] }>) => {
    conversation.setCitations(msg.turnId ?? '', msg.payload?.citations ?? [])
  })

  // ── digital-human:ready ────────────────────────────────────────────────────
  on('digital-human:ready', (msg: BaseWsMessage<{
    provider?: string
    digitalSessionId?: string
    speakMode?: 'pcm-stream' | 'text-direct'
    credentials?: Record<string, unknown>
  }>) => {
    if (!msg.sessionId) return
    digitalHuman.handleReady(msg.sessionId, msg.payload ?? {})
  })

  // ── webrtc:offer（兼容旧协议）────────────────────────────────────────────────
  on('webrtc:offer', (msg: BaseWsMessage<{
    sdpOffer?: { type: 'offer' | 'answer' | 'pranswer' | 'rollback'; sdp?: string } | null
    digitalSessionId?: string
    mock?: boolean
  }>) => {
    if (!msg.sessionId) return
    void digitalHuman.handleOffer(msg.sessionId, msg.payload ?? {})
  })

  // ── webrtc:ice-candidate（兼容旧协议）───────────────────────────────────────
  on('webrtc:ice-candidate', (msg: BaseWsMessage<{ candidate?: Record<string, unknown> }>) => {
    if (!msg.sessionId || !msg.payload?.candidate) return
    void digitalHuman.handleRemoteCandidate(
      msg.sessionId,
      msg.payload.candidate as {
        candidate?: string
        sdpMid?: string | null
        sdpMLineIndex?: number | null
        usernameFragment?: string | null
      },
    )
  })

  // ── tts:start ──────────────────────────────────────────────────────────────
  on('tts:start', (msg: BaseWsMessage<{ encoding?: string }>) => {
    conversation.state.value = 'speaking'
    if (msg.payload?.encoding === 'pcm') return
    audio.onTtsStart(msg.turnId ?? '')
  })

  // ── audio:chunk ────────────────────────────────────────────────────────────
  on(
    'audio:chunk',
    ({ meta, audioBytes }: { meta: { turnId?: string; codec?: string } | null; audioBytes: ArrayBuffer }) => {
      if (meta?.codec === 'audio/pcm') {
        digitalHuman.handlePcmChunk(audioBytes)
        return
      }
      const frameTurnId = meta?.turnId ?? audio.activeTurnId.get()
      audio.onAudioChunk(audioBytes, frameTurnId)
    },
  )

  // ── tts:end ────────────────────────────────────────────────────────────────
  on('tts:end', () => {
    audio.onTtsEnd()
    if (conversation.state.value === 'speaking') conversation.state.value = 'idle'
  })

  // ── digital-human:start ────────────────────────────────────────────────────
  on('digital-human:start', () => {
    conversation.state.value = 'speaking'
  })

  // ── digital-human:end ──────────────────────────────────────────────────────
  on('digital-human:end', () => {
    if (conversation.state.value === 'speaking' && !textChat.textRequestActive.value) {
      conversation.state.value = 'idle'
    }
  })

  // ── conversation:interrupted ───────────────────────────────────────────────
  on('conversation:interrupted', (msg: BaseWsMessage) => {
    if (msg.turnId) conversation.finishAssistantMessage(msg.turnId)
    audio.stopPlayback()
    if (conversation.state.value === 'thinking' || conversation.state.value === 'speaking') {
      conversation.state.value = 'idle'
    }
  })

  // ── error ──────────────────────────────────────────────────────────────────
  on('error', (msg: BaseWsMessage<{ message?: string }>) => {
    const message = msg.payload?.message ?? '发生错误'
    if (typeof message === 'string' && message.includes('No active session')) {
      sessionStore.setSession('', sessionStore.conversationId)
      if (personaStore.selectedId && sessionStore.connected) {
        send({
          type: 'session:start',
          sessionId: '',
          payload: { personaId: personaStore.selectedId, mode: mode.value },
        })
      }
      showToast('会话已失效，正在自动恢复')
      conversation.state.value = 'idle'
      sessionStore.setHistoryLoading(false)
      return
    }
    showToast('⚠ ' + message)
    conversation.state.value = 'idle'
    sessionStore.setHistoryLoading(false)
  })
}
