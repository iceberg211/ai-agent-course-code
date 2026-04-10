import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSessionStore = defineStore('session', () => {
  const sessionId = ref('')
  const conversationId = ref('')
  const connected = ref(false)
  /** 会话历史正在加载中（session:start 发出 → session:ready 收到之间） */
  const historyLoading = ref(false)

  function setSession(sid: string, cid: string) {
    sessionId.value = sid
    conversationId.value = cid
  }

  function setConnected(val: boolean) {
    connected.value = val
  }

  function setHistoryLoading(val: boolean) {
    historyLoading.value = val
  }

  function reset() {
    sessionId.value = ''
    conversationId.value = ''
  }

  return { sessionId, conversationId, connected, historyLoading, setSession, setConnected, setHistoryLoading, reset }
})
