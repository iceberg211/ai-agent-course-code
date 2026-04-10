import { ref } from 'vue'
import type { VoiceCloneState } from '../types'

export function useVoiceClone() {
  const state = ref<VoiceCloneState | null>(null)
  const loading = ref(false)
  const uploading = ref(false)
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  async function fetchStatus(personaId: string) {
    if (!personaId) return { ok: false, message: '缺少 personaId' }
    loading.value = true
    try {
      const res = await fetch(`/api/voice-clone/${personaId}/status`).catch(() => null)
      if (!res) {
        return { ok: false, message: '网络错误' }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, message: text || `HTTP ${res.status}` }
      }
      const data = await res.json().catch(() => null)
      if (!data || typeof data !== 'object') {
        return { ok: false, message: '状态返回格式错误' }
      }
      state.value = data as VoiceCloneState
      ensurePolling(personaId)
      return { ok: true }
    } finally {
      loading.value = false
    }
  }

  async function uploadSample(personaId: string, file: File) {
    if (!personaId || !file) {
      return { ok: false, message: '缺少参数' }
    }
    uploading.value = true
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/voice-clone/${personaId}`, {
        method: 'POST',
        body: form,
      }).catch(() => null)

      if (!res) {
        return { ok: false, message: '网络错误' }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, message: text || `HTTP ${res.status}` }
      }
      const data = await res.json().catch(() => null)
      if (!data || typeof data !== 'object') {
        return { ok: false, message: '克隆返回格式错误' }
      }
      state.value = data as VoiceCloneState
      ensurePolling(personaId)
      return { ok: true }
    } finally {
      uploading.value = false
    }
  }

  function clear() {
    state.value = null
    stopPolling()
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  function ensurePolling(personaId: string) {
    stopPolling()
    const status = state.value?.status
    if (status !== 'training' && status !== 'pending') return
    pollTimer = setTimeout(() => {
      void fetchStatus(personaId)
    }, 2500)
  }

  return {
    state,
    loading,
    uploading,
    fetchStatus,
    uploadSample,
    clear,
    stopPolling,
  }
}
