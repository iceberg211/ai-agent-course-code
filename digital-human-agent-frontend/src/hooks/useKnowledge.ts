import { ref } from 'vue'
import type { KnowledgeDocument, KnowledgeSearchResult } from '../types'

/**
 * 知识库文档管理
 * 依赖当前选中的 personaId（由外部传入）
 */
export function useKnowledge() {
  const documents = ref<KnowledgeDocument[]>([])
  const uploading = ref(false)
  const loading = ref(false)
  const searching = ref(false)
  const searchResult = ref<KnowledgeSearchResult | null>(null)

  async function fetchDocuments(personaId: string) {
    if (!personaId) return
    loading.value = true
    try {
      const res = await fetch(`/api/knowledge/${personaId}/documents`).catch(() => null)
      if (res?.ok) {
        const data = await res.json().catch(() => [])
        documents.value = Array.isArray(data) ? data : []
      }
    } finally {
      loading.value = false
    }
  }

  async function uploadDocument(personaId: string, file: File) {
    if (!personaId || !file) return { ok: false }
    uploading.value = true
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/knowledge/${personaId}/documents`, {
        method: 'POST',
        body: form,
      }).catch(() => null)
      if (res?.ok) await fetchDocuments(personaId)
      return { ok: !!res?.ok }
    } finally {
      uploading.value = false
    }
  }

  async function deleteDocument(personaId: string, docId: string) {
    const res = await fetch(
      `/api/knowledge/${personaId}/documents/${docId}`,
      { method: 'DELETE' }
    ).catch(() => null)
    if (res?.ok) await fetchDocuments(personaId)
    return { ok: !!res?.ok }
  }

  function statusLabel(status: string) {
    return { pending: '排队中', processing: '处理中', completed: '就绪', failed: '失败' }[status] ?? status
  }

  function clearDocuments() {
    documents.value = []
  }

  async function searchKnowledge(personaId: string, query: string) {
    const normalizedQuery = String(query ?? '').trim()
    if (!personaId || !normalizedQuery) {
      return { ok: false, message: '请输入检索内容' }
    }

    searching.value = true
    try {
      const res = await fetch(`/api/knowledge/${personaId}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: normalizedQuery,
          rerank: true,
          stage1TopK: 20,
          finalTopK: 5,
        }),
      }).catch(() => null)

      if (!res) {
        return { ok: false, message: '网络异常，请稍后重试' }
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({} as Record<string, unknown>))
        const message = typeof data.message === 'string' ? data.message : '检索接口调用失败'
        return { ok: false, message }
      }

      const data = await res.json().catch(() => null)
      if (
        !data ||
        !Array.isArray((data as { stage1?: unknown }).stage1) ||
        !Array.isArray((data as { stage2?: unknown }).stage2)
      ) {
        return { ok: false, message: '检索返回格式不正确' }
      }

      searchResult.value = data as KnowledgeSearchResult
      return { ok: true }
    } finally {
      searching.value = false
    }
  }

  function clearSearchResult() {
    searchResult.value = null
  }

  return {
    documents,
    uploading,
    loading,
    searching,
    searchResult,
    fetchDocuments,
    uploadDocument,
    deleteDocument,
    searchKnowledge,
    clearDocuments,
    clearSearchResult,
    statusLabel,
  }
}
