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
  let sessionToken = ''
  let wsUrl = 'wss://api.simli.ai/startWebRTCSession'

  // 双条件门控：Simli 发 START + data channel 已 open 才开始推音频
  let simliStarted = false
  let dcOpen = false
  let canSendAudio = false
  const audioQueue: Uint8Array[] = []
  const MAX_QUEUE = 120 // 约 120 × 20ms = 2.4s 缓冲

  // ── 公开方法 ───────────────────────────────────────────────────────

  function bindVideo(el: HTMLVideoElement | null) {
    videoEl.value = el
  }

  /**
   * 处理旧版 webrtc:offer 信令（兼容后端遗留协议，非主路径）
   */
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

  /**
   * 处理 digital-human:ready 消息，主路径：Simli pcm-stream 模式
   */
  function handleReady(sessionId: string, payload: ReadyPayload) {
    activeSessionId = sessionId
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

  /**
   * 接收来自后端 TTS Pipeline 的 PCM 音频块，转发给 Simli
   */
  function handlePcmChunk(audioBytes: ArrayBuffer) {
    if (!enabled.value) return
    if (status.value !== 'connecting' && status.value !== 'connected') return

    const bytes = new Uint8Array(audioBytes)
    if (bytes.byteLength === 0) return

    if (!canSendAudio) {
      // 未就绪时缓冲，防止丢帧
      if (audioQueue.length >= MAX_QUEUE) audioQueue.shift()
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

  // ── Simli 连接核心逻辑 ─────────────────────────────────────────────

  /**
   * 建立与 Simli 的 WebRTC 连接。
   *
   * 正确流程（Client-offer 模式）：
   *   1. 创建 RTCPeerConnection + data channel（用于发 PCM 给 Simli）
   *   2. addTransceiver recvonly（接收 Simli 返回的视频/音频）
   *   3. createOffer → setLocalDescription → 等待 ICE 收集
   *   4. 打开 WebSocket 到 Simli
   *   5. WS onopen：① 先发 sessionToken 认证  ② 再发 SDP offer JSON
   *   6. WS onmessage：
   *      - JSON { type: 'answer', sdp: ... } → setRemoteDescription
   *      - 字符串 'START' → 标记 simliStarted，触发 maybeStartAudio()
   *      - 字符串 'STOP'  → 关闭连接
   *   7. data channel onopen → 标记 dcOpen，触发 maybeStartAudio()
   *   8. maybeStartAudio：双条件满足后设 canSendAudio = true，刷音频队列
   */
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

      // Data channel：Simli 通过此通道接收 PCM 音频
      const dc = localPc.createDataChannel('datachannel', {
        ordered: true,
        maxRetransmits: 0, // 实时音频丢包优于重传
      })
      dataChannel = dc

      dc.onopen = () => {
        dcOpen = true
        maybeStartAudio()
      }

      dc.onclose = () => {
        dcOpen = false
        canSendAudio = false
      }

      // 只接收 Simli 发来的视频 + 音频，不向对端发送媒体
      localPc.addTransceiver('video', { direction: 'recvonly' })
      localPc.addTransceiver('audio', { direction: 'recvonly' })

      const offer = await localPc.createOffer()
      await localPc.setLocalDescription(offer)
      await waitIceGathering(localPc)

      const socket = new WebSocket(wsUrl)
      wsConnection = socket

      socket.onopen = () => {
        // ① 认证：session token 必须是 WebSocket 的第一条消息
        socket.send(sessionToken)

        // ② SDP offer
        const sdp = localPc.localDescription?.sdp
        const type = localPc.localDescription?.type
        if (sdp && type) {
          socket.send(JSON.stringify({ sdp, type }))
        }
      }

      socket.onmessage = async (evt) => {
        if (sessionId !== activeSessionId) return

        let text: string
        if (typeof evt.data === 'string') {
          text = evt.data
        } else if (evt.data instanceof Blob) {
          text = await evt.data.text()
        } else {
          return
        }

        if (text === 'START') {
          simliStarted = true
          maybeStartAudio()
          return
        }

        if (text === 'STOP') {
          void close()
          return
        }

        try {
          const msg = JSON.parse(text) as { type?: string; sdp?: string }
          if (
            msg.type === 'answer' &&
            msg.sdp &&
            localPc.signalingState !== 'closed'
          ) {
            await localPc.setRemoteDescription({ type: 'answer', sdp: msg.sdp })
          }
        } catch {
          // 非 JSON 文本（如心跳）忽略
        }
      }

      socket.onerror = () => {
        if (status.value !== 'idle') {
          status.value = 'error'
          lastError.value = 'Simli WebSocket 连接失败'
        }
      }

      socket.onclose = () => {
        dcOpen = false
        canSendAudio = false
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

  /**
   * 双条件门控：Simli START 信号 + data channel open，两者都满足才开始发音频
   */
  function maybeStartAudio() {
    if (!simliStarted) return
    if (!dcOpen) return
    if (canSendAudio) return // 已经开始了
    canSendAudio = true
    flushAudioQueue()
  }

  function flushAudioQueue() {
    while (audioQueue.length > 0) {
      const chunk = audioQueue.shift()
      if (!chunk) continue
      sendBinaryChunk(chunk)
    }
  }

  /**
   * 通过 data channel 发送 PCM 音频给 Simli（16-bit PCM，16kHz，单声道）
   */
  function sendBinaryChunk(chunk: Uint8Array) {
    if (!dataChannel || dataChannel.readyState !== 'open') return
    // new Uint8Array(chunk) 复制数据并返回 Uint8Array<ArrayBuffer>，满足 RTCDataChannel.send 类型要求
    dataChannel.send(new Uint8Array(chunk))
  }

  async function waitIceGathering(localPc: RTCPeerConnection) {
    if (localPc.iceGatheringState === 'complete') return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        localPc.removeEventListener('icegatheringstatechange', onStateChange)
        resolve()
      }, 3000)

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
    simliStarted = false
    dcOpen = false
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
        dataChannel.onopen = null
        dataChannel.onclose = null
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

    if (videoEl.value?.srcObject) {
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
