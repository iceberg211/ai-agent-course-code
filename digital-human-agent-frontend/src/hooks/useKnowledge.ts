import { ref } from 'vue'
import type { KnowledgeDocument } from '../types'

/**
 * 知识库文档管理
 * 依赖当前选中的 personaId（由外部传入）
 */
export function useKnowledge() {
  const documents = ref<KnowledgeDocument[]>([])
  const uploading = ref(false)
  const loading = ref(false)

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

  return { documents, uploading, loading, fetchDocuments, uploadDocument, deleteDocument, clearDocuments, statusLabel }
}
