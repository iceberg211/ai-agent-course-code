import { ref } from 'vue'
import { usePersonaStore } from '../stores/persona'
import { useSessionStore } from '../stores/session'
import { useConversation } from './useConversation'
import { useVoiceClone } from './useVoiceClone'
import { useDigitalHuman } from './useDigitalHuman'
import { useTextChat } from './useTextChat'

/**
 * Persona 相关操作 Hook。
 *
 * 职责：
 * - 切换 Persona（`onSelectPersona`）
 * - 删除 Persona（`onDeletePersona`）
 * - 切换对话模式（`onChangeMode`）
 *
 * historyLoading 改为直接操作 sessionStore，无需外部注入。
 * knowledgeDrawerOpen 移到 App.vue 本地 ref，与 Persona 操作无关。
 */
export function usePersonaActions(
  conversation: ReturnType<typeof useConversation>,
  voiceClone: ReturnType<typeof useVoiceClone>,
  digitalHuman: ReturnType<typeof useDigitalHuman>,
  textChat: ReturnType<typeof useTextChat>,
  send: (msg: object) => void,
  showToast: (msg: string) => void,
) {
  const personaStore = usePersonaStore()
  const sessionStore = useSessionStore()
  const mode = ref<string>('voice')

  function onSelectPersona(id: string) {
    if (id === personaStore.selectedId) return

    textChat.reset()
    void digitalHuman.close()

    personaStore.select(id)
    voiceClone.clear()
    conversation.clearMessages()
    sessionStore.reset()
    sessionStore.setHistoryLoading(true)

    if (!sessionStore.connected) {
      showToast('连接恢复后将自动建立语音会话')
      return
    }

    send({
      type: 'session:start',
      sessionId: '',
      payload: { personaId: id, mode: mode.value },
    })
  }

  async function onDeletePersona(personaId: string) {
    const target = personaStore.personas.find((p) => p.id === personaId)
    const name = target?.name ?? '该角色'
    if (!confirm(`确认删除「${name}」？其对话会一并删除，已挂载知识库不受影响。`)) return

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
      sessionStore.setHistoryLoading(false)
      textChat.reset()
      void digitalHuman.close()
      conversation.clearMessages()
      conversation.state.value = 'idle'
      voiceClone.clear()
    }

    showToast(`✓ 已删除「${name}」`)
  }

  async function onChangeMode(nextMode: string) {
    if (mode.value === nextMode) return
    mode.value = nextMode
    void digitalHuman.close()

    if (!personaStore.selectedId || !sessionStore.connected) return
    sessionStore.reset()
    sessionStore.setHistoryLoading(true)
    send({
      type: 'session:start',
      sessionId: '',
      payload: { personaId: personaStore.selectedId, mode: mode.value },
    })
  }

  function onNewConversation() {
    if (!personaStore.selectedId || !sessionStore.connected) return

    textChat.reset()
    conversation.clearMessages()
    sessionStore.setHistoryLoading(true)

    send({
      type: 'session:start',
      sessionId: '',
      payload: { personaId: personaStore.selectedId, mode: mode.value, forceNew: true },
    })
  }

  return {
    mode,
    onSelectPersona,
    onDeletePersona,
    onChangeMode,
    onNewConversation,
  }
}
