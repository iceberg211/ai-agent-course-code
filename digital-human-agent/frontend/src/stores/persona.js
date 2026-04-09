import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const usePersonaStore = defineStore('persona', () => {
  const personas = ref([])
  const selectedId = ref('')

  const selectedPersona = computed(() =>
    personas.value.find((p) => p.id === selectedId.value) ?? null
  )

  async function fetchPersonas() {
    const res = await fetch('/api/personas').catch(() => null)
    if (res?.ok) personas.value = await res.json()
  }

  function select(id) {
    selectedId.value = id
  }

  return { personas, selectedId, selectedPersona, fetchPersonas, select }
})
