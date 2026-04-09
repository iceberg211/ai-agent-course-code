import { ref } from 'vue'

export function useAudio() {
  // ── 录音 ──────────────────────────────────────────────
  let mediaRecorder = null
  const chunks = []

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
    return new Promise((resolve) => {
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        resolve(await blob.arrayBuffer())
      }
      mediaRecorder.stop()
      mediaRecorder.stream.getTracks().forEach((t) => t.stop())
    })
  }

  // ── TTS 流式播放 ──────────────────────────────────────
  const audioEl = ref(null)        // <audio> 元素引用
  let mediaSource = null
  let sourceBuffer = null
  let appendQueue = []
  let activeTurnId = null

  function initAudioElement(el) {
    audioEl.value = el
  }

  function onTtsStart(turnId) {
    activeTurnId = turnId
    appendQueue = []

    mediaSource = new MediaSource()
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

  function onAudioChunk(buffer, turnId) {
    if (turnId !== activeTurnId) return   // 旧 turn 的帧丢弃
    appendQueue.push(new Uint8Array(buffer))
    flushQueue()
  }

  function flushQueue() {
    if (!sourceBuffer || sourceBuffer.updating || appendQueue.length === 0) return
    sourceBuffer.appendBuffer(appendQueue.shift())
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
