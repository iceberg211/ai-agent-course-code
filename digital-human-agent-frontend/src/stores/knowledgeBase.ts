import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { KnowledgeBase } from '../types'

export const useKnowledgeBaseStore = defineStore('knowledgeBase', () => {
  const list = ref<KnowledgeBase[]>([])
  const current = ref<KnowledgeBase | null>(null)

  const byId = computed(() => {
    const map = new Map<string, KnowledgeBase>()
    for (const kb of list.value) map.set(kb.id, kb)
    return map
  })

  function setList(items: KnowledgeBase[]) {
    list.value = items
  }

  function setCurrent(kb: KnowledgeBase | null) {
    current.value = kb
  }

  function upsert(kb: KnowledgeBase) {
    const idx = list.value.findIndex((x) => x.id === kb.id)
    if (idx >= 0) list.value.splice(idx, 1, kb)
    else list.value.unshift(kb)
    if (current.value?.id === kb.id) current.value = kb
  }

  function removeById(kbId: string) {
    list.value = list.value.filter((kb) => kb.id !== kbId)
    if (current.value?.id === kbId) current.value = null
  }

  return { list, current, byId, setList, setCurrent, upsert, removeById }
})
