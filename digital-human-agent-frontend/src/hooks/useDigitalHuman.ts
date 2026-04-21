import { ref } from 'vue'
import { LogLevel, SimliClient } from 'simli-client'
import { DIGITAL_HUMAN_DEFAULT_WS_URL } from '@/common/constants'

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

type DigitalHumanStatus = 'idle' | 'connecting' | 'connected' | 'mock' | 'error'

export function useDigitalHuman(_send: (msg: Record<string, unknown>) => void) {
  const videoEl = ref<HTMLVideoElement | null>(null)
  const audioEl = ref<HTMLAudioElement | null>(null)
  const status = ref<DigitalHumanStatus>('idle')
  const lastError = ref('')
  const enabled = ref(false)

  let simliClient: SimliClient | null = null
  let activeSessionId = ''
  let sessionToken = ''
  let simliWsBaseUrl = DIGITAL_HUMAN_DEFAULT_WS_URL
  let readyToSendAudio = false

  const audioQueue: Uint8Array[] = []
  const MAX_QUEUE = 120

  function bindVideo(el: HTMLVideoElement | null) {
    videoEl.value = el
  }

  function bindAudio(el: HTMLAudioElement | null) {
    audioEl.value = el
  }

  async function handleOffer(_sessionId: string, payload: OfferPayload) {
    if (payload?.mock) {
      enabled.value = true
      status.value = 'mock'
    }
  }

  async function handleRemoteCandidate(
    _sessionId: string,
    _candidate: RTCIceCandidateInit,
  ) {
    return
  }

  function handleReady(sessionId: string, payload: ReadyPayload) {
    activeSessionId = sessionId
    enabled.value = true
    lastError.value = ''

    const credentials = payload.credentials ?? {}
    const provider = String(payload.provider ?? credentials.provider ?? '').toLowerCase()
    const speakMode = String(payload.speakMode ?? '')
    sessionToken = String(credentials.sessionToken ?? '')
    simliWsBaseUrl = deriveSimliWsBaseUrl(
      String(credentials.wsUrl ?? DIGITAL_HUMAN_DEFAULT_WS_URL),
    )

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

    if (!readyToSendAudio) {
      if (audioQueue.length >= MAX_QUEUE) audioQueue.shift()
      audioQueue.push(bytes)
      return
    }

    sendAudioChunk(bytes)
  }

  async function close() {
    enabled.value = false
    status.value = 'idle'
    lastError.value = ''
    activeSessionId = ''
    sessionToken = ''
    await teardownClient()
  }

  async function startSimliConnection(sessionId: string) {
    if (!videoEl.value || !audioEl.value) {
      status.value = 'error'
      lastError.value = '数字人播放器未初始化完成，请刷新页面后重试'
      return
    }

    try {
      status.value = 'connecting'
      lastError.value = ''
      readyToSendAudio = false
      await teardownClient()

      const currentVideo = videoEl.value
      const currentAudio = audioEl.value
      currentAudio.autoplay = true

      const client = new SimliClient(
        sessionToken,
        currentVideo,
        currentAudio,
        null,
        LogLevel.INFO,
        'livekit',
        'websockets',
        simliWsBaseUrl,
      )
      simliClient = client

      client.on('start', () => {
        if (sessionId !== activeSessionId) return
        status.value = 'connected'
        readyToSendAudio = true
        void currentVideo.play().catch(() => undefined)
        void currentAudio.play().catch(() => undefined)
        flushAudioQueue()
      })

      client.on('error', (detail) => {
        if (sessionId !== activeSessionId) return
        status.value = 'error'
        lastError.value = normalizeError(detail)
        readyToSendAudio = false
      })

      client.on('startup_error', (detail) => {
        if (sessionId !== activeSessionId) return
        status.value = 'error'
        lastError.value = normalizeError(detail)
        readyToSendAudio = false
      })

      client.on('stop', () => {
        if (sessionId !== activeSessionId) return
        readyToSendAudio = false
        if (enabled.value) {
          status.value = 'idle'
        }
      })

      await client.start()

      if (sessionId !== activeSessionId) {
        await client.stop().catch(() => undefined)
        return
      }

      if (status.value === 'connecting') {
        status.value = 'connected'
        readyToSendAudio = true
        flushAudioQueue()
      }
    } catch (error) {
      status.value = 'error'
      lastError.value = normalizeError(error)
      readyToSendAudio = false
    }
  }

  function flushAudioQueue() {
    while (audioQueue.length > 0) {
      const chunk = audioQueue.shift()
      if (!chunk) continue
      sendAudioChunk(chunk)
    }
  }

  function sendAudioChunk(chunk: Uint8Array) {
    if (!simliClient || !readyToSendAudio) return
    simliClient.sendAudioData(new Uint8Array(chunk))
  }

  async function teardownClient() {
    readyToSendAudio = false
    audioQueue.length = 0

    const client = simliClient
    simliClient = null

    if (client) {
      try {
        await client.stop()
      } catch {
        // 忽略停止阶段的幂等错误
      }
    }

    if (videoEl.value?.srcObject) {
      videoEl.value.srcObject = null
    }
    if (audioEl.value) {
      audioEl.value.pause()
      audioEl.value.srcObject = null
      audioEl.value.src = ''
    }
  }

  function deriveSimliWsBaseUrl(rawUrl: string) {
    try {
      const url = new URL(rawUrl)
      return `${url.protocol}//${url.host}`
    } catch {
      return 'wss://api.simli.ai'
    }
  }

  function normalizeError(error: unknown) {
    if (typeof error === 'string' && error.trim()) return error
    if (error instanceof Error && error.message.trim()) return error.message
    return '数字人连接失败'
  }

  return {
    videoEl,
    status,
    enabled,
    lastError,
    bindVideo,
    bindAudio,
    handleOffer,
    handleRemoteCandidate,
    handleReady,
    handlePcmChunk,
    close,
  }
}
