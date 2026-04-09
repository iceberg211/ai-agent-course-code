import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSessionStore = defineStore('session', () => {
  const sessionId = ref('')
  const conversationId = ref('')
  const connected = ref(false)

  function setSession(sid, cid) {
    sessionId.value = sid
    conversationId.value = cid
  }

  function setConnected(val) {
    connected.value = val
  }

  function reset() {
    sessionId.value = ''
    conversationId.value = ''
  }

  return { sessionId, conversationId, connected, setSession, setConnected, reset }
})
