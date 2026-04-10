import { ref } from 'vue'
import { usePersonaStore } from '../stores/persona'
import { useSessionStore } from '../stores/session'
import { useConversation } from './useConversation'
import { useKnowledge } from './useKnowledge'
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
 * 操作前后协调各 sub-hook 的状态重置，避免 useAppController 承担过多协调责任。
 */
export function usePersonaActions(
  conversation: ReturnType<typeof useConversation>,
  knowledge: ReturnType<typeof useKnowledge>,
  voiceClone: ReturnType<typeof useVoiceClone>,
  digitalHuman: ReturnType<typeof useDigitalHuman>,
  textChat: ReturnType<typeof useTextChat>,
  historyLoading: { value: boolean },
  docsOpen: { value: boolean },
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
    knowledge.clearSearchResult()
    conversation.clearMessages()
    sessionStore.reset()
    historyLoading.value = true

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
      textChat.reset()
      void digitalHuman.close()
      conversation.clearMessages()
      conversation.state.value = 'idle'
      historyLoading.value = false
      knowledge.clearDocuments()
      knowledge.clearSearchResult()
      voiceClone.clear()
      docsOpen.value = false
    }

    showToast(`✓ 已删除「${name}」`)
  }

  async function onChangeMode(nextMode: string) {
    if (mode.value === nextMode) return
    mode.value = nextMode
    void digitalHuman.close()

    if (!personaStore.selectedId || !sessionStore.connected) return
    sessionStore.reset()
    historyLoading.value = true
    send({
      type: 'session:start',
      sessionId: '',
      payload: { personaId: personaStore.selectedId, mode: mode.value },
    })
  }

  return {
    mode,
    onSelectPersona,
    onDeletePersona,
    onChangeMode,
  }
}
