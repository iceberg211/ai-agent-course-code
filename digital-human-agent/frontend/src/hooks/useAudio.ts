import { ref } from 'vue'

export function useAudio() {
  // ── 录音 ──────────────────────────────────────────────
  let mediaRecorder: MediaRecorder | null = null
  const chunks: Blob[] = []

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunks.length = 0
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    mediaRecorder.start(100) // 100ms slice
  }

  async function stopRecording() {
    if (!mediaRecorder) {
      return new ArrayBuffer(0)
    }

    if (mediaRecorder.state === 'inactive') {
      const blob = new Blob(chunks, { type: 'audio/webm' })
      return blob.arrayBuffer()
    }

    return new Promise<ArrayBuffer>((resolve) => {
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        mediaRecorder = null
        resolve(await blob.arrayBuffer())
      }
      mediaRecorder.stop()
      mediaRecorder.stream.getTracks().forEach((t) => t.stop())
    })
  }

  // ── TTS 流式播放 ──────────────────────────────────────
  const audioEl = ref<HTMLAudioElement | null>(null)
  let mediaSource: MediaSource | null = null
  let sourceBuffer: SourceBuffer | null = null
  let appendQueue: ArrayBuffer[] = []
  let activeTurnId: string | null = null

  function initAudioElement(el: HTMLAudioElement | null) {
    audioEl.value = el
  }

  function onTtsStart(turnId: string) {
    activeTurnId = turnId
    appendQueue = []

    mediaSource = new MediaSource()
    if (!audioEl.value) return
    audioEl.value.src = URL.createObjectURL(mediaSource)

    mediaSource.addEventListener('sourceopen', () => {
      try {
        sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg')
      } catch {
        sourceBuffer = mediaSource.addSourceBuffer('audio/webm; codecs=opus')
      }
      sourceBuffer.addEventListener('updateend', flushQueue)
    }, { once: true })

    audioEl.value.play().catch(() => { })
  }

  function onAudioChunk(buffer: ArrayBuffer, turnId: string | null | undefined) {
    if (turnId !== activeTurnId) return   // 旧 turn 的帧丢弃
    appendQueue.push(buffer.slice(0))
    flushQueue()
  }

  function flushQueue() {
    if (!sourceBuffer || sourceBuffer.updating || appendQueue.length === 0) return
    const chunk = appendQueue.shift()
    if (!chunk) return
    sourceBuffer.appendBuffer(chunk)
  }

  function onTtsEnd() {
    activeTurnId = null
  }

  function stopPlayback() {
    activeTurnId = null
    appendQueue = []
    if (audioEl.value) {
      audioEl.value.pause()
      audioEl.value.src = ''
    }
  }

  return {
    startRecording, stopRecording,
    initAudioElement, onTtsStart, onAudioChunk, onTtsEnd, stopPlayback,
    activeTurnId: { get: () => activeTurnId },
  }
}
