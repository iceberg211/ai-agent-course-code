import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSessionStore = defineStore('session', () => {
  const sessionId = ref('')
  const conversationId = ref('')
  const connected = ref(false)

  function setSession(sid: string, cid: string) {
    sessionId.value = sid
    conversationId.value = cid
  }

  function setConnected(val: boolean) {
    connected.value = val
  }

  function reset() {
    sessionId.value = ''
    conversationId.value = ''
  }

  return { sessionId, conversationId, connected, setSession, setConnected, reset }
})
