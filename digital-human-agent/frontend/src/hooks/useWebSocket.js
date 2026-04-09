import { ref, onUnmounted } from 'vue'

export function useWebSocket() {
  const ws = ref(null)
  const sessionId = ref('')
  const connected = ref(false)
  const listeners = new Map()

  function connect() {
    ws.value = new WebSocket(`ws://${location.host}/ws/conversation`)

    ws.value.onopen = () => {
      connected.value = true
      console.log('[WS] connected')
    }

    ws.value.onclose = () => {
      connected.value = false
      console.log('[WS] disconnected, retry in 3s')
      setTimeout(connect, 3000)
    }

    ws.value.onerror = (e) => console.error('[WS] error', e)

    ws.value.onmessage = async (event) => {
      // Binary：TTS 音频帧
      if (event.data instanceof Blob) {
        emit('audio:chunk', await event.data.arrayBuffer())
        return
      }
      try {
        const msg = JSON.parse(event.data)
        emit(msg.type, msg)
      } catch (e) {
        console.error('[WS] parse error', e)
      }
    }
  }

  function send(msg) {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(msg))
    }
  }

  function sendBinary(buffer) {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(buffer)
    }
  }

  function on(type, handler) {
    if (!listeners.has(type)) listeners.set(type, [])
    listeners.get(type).push(handler)
  }

  function off(type, handler) {
    const arr = listeners.get(type) ?? []
    const idx = arr.indexOf(handler)
    if (idx !== -1) arr.splice(idx, 1)
  }

  function emit(type, data) {
    ;(listeners.get(type) ?? []).forEach((fn) => fn(data))
  }

  onUnmounted(() => {
    ws.value?.close()
  })

  return { connect, send, sendBinary, on, off, sessionId, connected }
}
