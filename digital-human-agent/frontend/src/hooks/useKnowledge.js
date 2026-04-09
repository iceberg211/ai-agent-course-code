import { ref } from 'vue'

/**
 * 知识库文档管理
 * 依赖当前选中的 personaId（由外部传入）
 */
export function useKnowledge() {
  const documents = ref([])
  const uploading = ref(false)

  async function fetchDocuments(personaId) {
    if (!personaId) return
    const res = await fetch(`/api/knowledge/${personaId}/documents`).catch(() => null)
    if (res?.ok) documents.value = await res.json()
  }

  async function uploadDocument(personaId, file) {
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

  async function deleteDocument(personaId, docId) {
    const res = await fetch(
      `/api/knowledge/${personaId}/documents/${docId}`,
      { method: 'DELETE' }
    ).catch(() => null)
    if (res?.ok) await fetchDocuments(personaId)
    return { ok: !!res?.ok }
  }

  function statusLabel(status) {
    return { pending: '排队中', processing: '处理中', completed: '就绪', failed: '失败' }[status] ?? status
  }

  return { documents, uploading, fetchDocuments, uploadDocument, deleteDocument, statusLabel }
}
