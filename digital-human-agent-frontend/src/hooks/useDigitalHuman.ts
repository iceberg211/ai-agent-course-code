import { ref } from 'vue'

interface RTCSessionDescriptionInit {
  type: 'answer' | 'offer' | 'pranswer' | 'rollback'
  sdp?: string
}

interface RTCIceCandidateInit {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

interface OfferPayload {
  sdpOffer?: RTCSessionDescriptionInit | null
  digitalSessionId?: string
  mock?: boolean
}

interface ReadyPayload {
  provider?: string
  digitalSessionId?: string
  speakMode?: 'pcm-stream' | 'text-direct'
  credentials?: Record<string, unknown>
}

export function useDigitalHuman(send: (msg: Record<string, unknown>) => void) {
  const videoEl = ref<HTMLVideoElement | null>(null)
  const status = ref<'idle' | 'connecting' | 'connected' | 'mock' | 'error'>('idle')
  const lastError = ref('')
  const enabled = ref(false)

  let pc: RTCPeerConnection | null = null
  let wsConnection: WebSocket | null = null
  let dataChannel: RTCDataChannel | null = null
  let activeSessionId = ''
  let readyPayload: ReadyPayload | null = null
  let sessionToken = ''
  let wsUrl = 'wss://api.simli.ai/startWebRTCSession'
  let tokenSent = false
  let canSendAudio = false
  const audioQueue: Uint8Array[] = []

  function bindVideo(el: HTMLVideoElement | null) {
    videoEl.value = el
  }

  async function handleOffer(sessionId: string, payload: OfferPayload) {
    activeSessionId = sessionId
    lastError.value = ''

    const offer = payload?.sdpOffer
    if (!offer?.sdp || payload?.mock) {
      status.value = 'mock'
      enabled.value = true
      return
    }

    try {
      status.value = 'connecting'
      enabled.value = true
      await resetPeerConnection()
      pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })

      pc.onicecandidate = (event) => {
        if (!event.candidate) return
        send({
          type: 'webrtc:ice-candidate',
          sessionId,
          payload: { candidate: event.candidate.toJSON() },
        })
      }

      pc.ontrack = (event) => {
        const stream = event.streams?.[0]
        if (!stream || !videoEl.value) return
        videoEl.value.srcObject = stream
        void videoEl.value.play().catch(() => undefined)
        status.value = 'connected'
      }

      await pc.setRemoteDescription(offer)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      send({
        type: 'webrtc:answer',
        sessionId,
        payload: { sdpAnswer: { type: answer.type, sdp: answer.sdp } },

      })
    } catch (error) {
      status.value = 'error'
      lastError.value = error instanceof Error ? error.message : String(error ?? '')
    }
  }

  async function handleRemoteCandidate(sessionId: string, candidate: RTCIceCandidateInit) {
    if (sessionId !== activeSessionId) return
    if (!pc || !candidate) return
    try {
      await pc.addIceCandidate(candidate)
    } catch (error) {
      console.warn('[digital-human] addIceCandidate failed', error)
    }
  }

  function handleReady(sessionId: string, payload: ReadyPayload) {
    activeSessionId = sessionId
    readyPayload = payload
    enabled.value = true
    lastError.value = ''

    const credentials = payload.credentials ?? {}
    const provider = String(payload.provider ?? credentials.provider ?? '').toLowerCase()
    const speakMode = String(payload.speakMode ?? '')
    sessionToken = String(credentials.sessionToken ?? '')
    wsUrl = String(credentials.wsUrl ?? 'wss://api.simli.ai/startWebRTCSession')

    if (provider !== 'simli' || speakMode !== 'pcm-stream' || !sessionToken) {
      status.value = 'mock'
      if (!sessionToken) {
        lastError.value = '未拿到 Simli sessionToken，请检查后端 DIGITAL_HUMAN_PROVIDER 和 SIMLI 配置'
      }
      return
    }

    void startSimliConnection(sessionId)
  }

  function handlePcmChunk(audioBytes: ArrayBuffer) {
    if (!enabled.value) return
    if (status.value !== 'connecting' && status.value !== 'connected') return

    const bytes = new Uint8Array(audioBytes)
    if (bytes.byteLength === 0) return

    if (!canSendAudio || !wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      if (audioQueue.length > 50) audioQueue.shift()
      audioQueue.push(bytes)
      return
    }

    sendBinaryChunk(bytes)
  }

  async function close() {
    enabled.value = false
    status.value = 'idle'
    lastError.value = ''
    activeSessionId = ''
    sessionToken = ''
    await resetPeerConnection()
  }

  async function startSimliConnection(sessionId: string) {
    try {
      status.value = 'connecting'
      await resetPeerConnection()

      const localPc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })
      pc = localPc

      localPc.ontrack = (event) => {
        const stream = event.streams?.[0]
        if (!stream || !videoEl.value) return
        videoEl.value.srcObject = stream
        videoEl.value.muted = false
        void videoEl.value.play().catch(() => undefined)
        status.value = 'connected'
      }

      // Simli 会通过 data channel 同步会话状态；即使不直接发音频，也需要创建。
      dataChannel = localPc.createDataChannel('datachannel', { ordered: true })
      dataChannel.onopen = () => {
        maybeSendSessionToken()
      }

      // 接收远端媒体流
      localPc.addTransceiver('video', { direction: 'recvonly' })
      localPc.addTransceiver('audio', { direction: 'recvonly' })

      const offer = await localPc.createOffer()
      await localPc.setLocalDescription(offer)
      await waitIceGathering(localPc)

      const socket = new WebSocket(wsUrl)
      wsConnection = socket

      socket.onopen = () => {
        const sdp = localPc.localDescription?.sdp
        const type = localPc.localDescription?.type
        if (!sdp || !type) return
        socket.send(JSON.stringify({ sdp, type }))
        maybeSendSessionToken()
      }

      socket.onmessage = async (evt) => {
        if (sessionId !== activeSessionId) return

        const text =
          typeof evt.data === 'string'
            ? evt.data
            : evt.data instanceof Blob
              ? await evt.data.text()
              : ''

        if (!text) return
        if (text === 'START') {
          canSendAudio = true
          flushAudioQueue()
          return
        }
        if (text === 'STOP') {
          void close()
          return
        }

        try {
          const message = JSON.parse(text) as {
            type?: string
            sdp?: string
          }
          if (message.type === 'answer' && message.sdp && localPc.signalingState !== 'closed') {
            await localPc.setRemoteDescription({
              type: 'answer',
              sdp: message.sdp,
            })
            maybeSendSessionToken()
          }
        } catch {
          // 忽略非 JSON 文本消息（如 ping/pong）
        }
      }

      socket.onerror = () => {
        if (status.value !== 'idle') {
          status.value = 'error'
          lastError.value = 'Simli WebSocket 连接失败'
        }
      }

      socket.onclose = () => {
        if (enabled.value && status.value === 'connecting') {
          status.value = 'error'
          lastError.value = 'Simli 连接已关闭'
        }
      }
    } catch (error) {
      status.value = 'error'
      lastError.value = error instanceof Error ? error.message : String(error ?? '')
    }
  }

  function maybeSendSessionToken() {
    if (tokenSent) return
    if (!sessionToken) return
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return
    if (!dataChannel || dataChannel.readyState !== 'open') return
    wsConnection.send(sessionToken)
    tokenSent = true
  }

  function flushAudioQueue() {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return
    while (audioQueue.length > 0) {
      const chunk = audioQueue.shift()
      if (!chunk) continue
      sendBinaryChunk(chunk)
    }
  }

  function sendBinaryChunk(chunk: Uint8Array) {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return
    const payload = new Uint8Array(chunk.byteLength)
    payload.set(chunk)
    wsConnection.send(payload.buffer)
  }

  async function waitIceGathering(localPc: RTCPeerConnection) {
    if (localPc.iceGatheringState === 'complete') return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        localPc.removeEventListener('icegatheringstatechange', onStateChange)
        resolve()
      }, 2000)

      const onStateChange = () => {
        if (localPc.iceGatheringState === 'complete') {
          clearTimeout(timer)
          localPc.removeEventListener('icegatheringstatechange', onStateChange)
          resolve()
        }
      }
      localPc.addEventListener('icegatheringstatechange', onStateChange)
    })
  }

  async function resetPeerConnection() {
    canSendAudio = false
    tokenSent = false
    readyPayload = null
    audioQueue.length = 0

    if (wsConnection) {
      try {
        wsConnection.onopen = null
        wsConnection.onmessage = null
        wsConnection.onerror = null
        wsConnection.onclose = null
        wsConnection.close()
      } catch {
        // ignore
      }
      wsConnection = null
    }

    if (dataChannel) {
      try {
        dataChannel.close()
      } catch {
        // ignore
      }
      dataChannel = null
    }

    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.close()
      pc = null
    }
    if (videoEl.value && videoEl.value.srcObject) {
      videoEl.value.srcObject = null
    }
  }

  return {
    videoEl,
    status,
    enabled,
    lastError,
    bindVideo,
    handleOffer,
    handleRemoteCandidate,
    handleReady,
    handlePcmChunk,
    close,
  }
}
