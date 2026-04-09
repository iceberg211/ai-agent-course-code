import { ref, onUnmounted } from 'vue'

export function useWebSocket() {
  const ws = ref(null)
  const sessionId = ref('')
  const connected = ref(false)
  const listeners = new Map()
  let reconnectTimer = null
  let heartbeatTimer = null
  let manualClose = false

  function connect() {
    if (
      ws.value &&
      (ws.value.readyState === WebSocket.OPEN ||
        ws.value.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    manualClose = false
    ws.value = new WebSocket(`ws://${location.host}/ws/conversation`)

    ws.value.onopen = () => {
      connected.value = true
      console.log('[WS] connected')
      startHeartbeat()
    }

    ws.value.onclose = () => {
      connected.value = false
      stopHeartbeat()
      ws.value = null
      if (manualClose) return
      console.log('[WS] disconnected, retry in 3s')
      scheduleReconnect()
    }

    ws.value.onerror = (e) => console.error('[WS] error', e)

    ws.value.onmessage = async (event) => {
      // Binary：TTS 音频帧（[4-byte metaLength][meta JSON][audio bytes]）
      if (event.data instanceof Blob) {
        emit('audio:chunk', await decodeAudioFrame(event.data))
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

  function scheduleReconnect() {
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => {
      connect()
    }, 3000)
  }

  function startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      send({ type: 'ping', payload: { ts: Date.now() } })
    }, 15000)
  }

  function stopHeartbeat() {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  async function decodeAudioFrame(blob) {
    const raw = await blob.arrayBuffer()
    if (raw.byteLength < 4) {
      return { meta: null, audioBytes: raw }
    }

    const view = new DataView(raw)
    const metaLength = view.getUint32(0)
    const totalHeader = 4 + metaLength

    if (metaLength <= 0 || totalHeader > raw.byteLength) {
      return { meta: null, audioBytes: raw }
    }

    try {
      const metaBytes = new Uint8Array(raw, 4, metaLength)
      const metaText = new TextDecoder().decode(metaBytes)
      const meta = JSON.parse(metaText)
      const audioBytes = raw.slice(totalHeader)
      return { meta, audioBytes }
    } catch {
      return { meta: null, audioBytes: raw }
    }
  }

  onUnmounted(() => {
    manualClose = true
    clearTimeout(reconnectTimer)
    stopHeartbeat()
    ws.value?.close()
    ws.value = null
  })

  return { connect, send, sendBinary, on, off, sessionId, connected }
}
