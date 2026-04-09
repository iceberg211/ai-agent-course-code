import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Persona } from '../types'

export const usePersonaStore = defineStore('persona', () => {
  const personas = ref<Persona[]>([])
  const selectedId = ref('')
  const loading = ref(false)
  const loadError = ref('')

  const selectedPersona = computed(() =>
    personas.value.find((p) => p.id === selectedId.value) ?? undefined
  )

  async function fetchPersonas() {
    loading.value = true
    loadError.value = ''
    const res = await fetch('/api/personas').catch(() => null)
    if (!res) {
      console.error('[Persona] 请求 /api/personas 失败：网络错误')
      loadError.value = '网络错误'
      loading.value = false
      return
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[Persona] 请求 /api/personas 失败：HTTP ${res.status}`, text)
      loadError.value = `HTTP ${res.status}`
      loading.value = false
      return
    }

    const data = await res.json().catch(() => [])
    personas.value = Array.isArray(data) ? data : []
    loading.value = false
  }

  async function deletePersona(id: string) {
    if (!id) return { ok: false, message: '缺少角色 ID' }
    const res = await fetch(`/api/personas/${id}`, { method: 'DELETE' }).catch(() => null)

    if (!res) {
      console.error(`[Persona] 删除 /api/personas/${id} 失败：网络错误`)
      return { ok: false, message: '网络错误' }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[Persona] 删除 /api/personas/${id} 失败：HTTP ${res.status}`, text)
      return { ok: false, message: `HTTP ${res.status}` }
    }

    personas.value = personas.value.filter((p) => p.id !== id)
    if (selectedId.value === id) {
      selectedId.value = ''
    }
    return { ok: true }
  }

  function select(id: string) {
    selectedId.value = id
  }

  return { personas, selectedId, selectedPersona, loading, loadError, fetchPersonas, deletePersona, select }
})
