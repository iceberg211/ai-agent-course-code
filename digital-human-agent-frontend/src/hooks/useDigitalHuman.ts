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

export function useDigitalHuman(send: (msg: Record<string, unknown>) => void) {
  const videoEl = ref<HTMLVideoElement | null>(null)
  const status = ref<'idle' | 'connecting' | 'connected' | 'mock' | 'error'>('idle')
  const lastError = ref('')
  const enabled = ref(false)

  let pc: RTCPeerConnection | null = null
  let activeSessionId = ''

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
        payload: { sdpAnswer: answer.toJSON() },
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

  async function close() {
    enabled.value = false
    status.value = 'idle'
    lastError.value = ''
    activeSessionId = ''
    await resetPeerConnection()
  }

  async function resetPeerConnection() {
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
    close,
  }
}
