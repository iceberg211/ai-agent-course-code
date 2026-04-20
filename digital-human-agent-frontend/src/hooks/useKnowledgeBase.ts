import { ref } from 'vue'
import type {
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeDocumentDetail,
  KnowledgeSearchResult,
  RetrievalFusionConfig,
  RetrievalMode,
  RetrievalConfig,
} from '../types'

export interface CreateKnowledgeBasePayload {
  name: string
  description?: string
  ownerPersonaId?: string
  retrievalConfig?: Partial<RetrievalConfig>
}

export interface UpdateKnowledgeBasePayload extends Partial<CreateKnowledgeBasePayload> {}

async function fetchJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const res = await fetch(input, init)
    if (!res.ok) {
      console.error(
        `[useKnowledgeBase] ${init?.method ?? 'GET'} ${input} -> HTTP ${res.status}`,
      )
      return null
    }
    return (await res.json()) as T
  } catch (e) {
    console.error(`[useKnowledgeBase] network error ${input}:`, e)
    return null
  }
}

export function useKnowledgeBase() {
  const listLoading = ref(false)
  const detailLoading = ref(false)
  const documentsLoading = ref(false)
  const chunksLoading = ref(false)
  const searching = ref(false)
  const uploading = ref(false)

  async function listAll(): Promise<KnowledgeBase[]> {
    listLoading.value = true
    try {
      return (await fetchJson<KnowledgeBase[]>('/api/knowledge-bases')) ?? []
    } finally {
      listLoading.value = false
    }
  }

  async function getById(kbId: string): Promise<KnowledgeBase | null> {
    detailLoading.value = true
    try {
      return await fetchJson<KnowledgeBase>(`/api/knowledge-bases/${kbId}`)
    } finally {
      detailLoading.value = false
    }
  }

  async function create(
    payload: CreateKnowledgeBasePayload,
  ): Promise<KnowledgeBase | null> {
    return fetchJson<KnowledgeBase>('/api/knowledge-bases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  async function update(
    kbId: string,
    payload: UpdateKnowledgeBasePayload,
  ): Promise<KnowledgeBase | null> {
    return fetchJson<KnowledgeBase>(`/api/knowledge-bases/${kbId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  async function remove(kbId: string): Promise<boolean> {
    const res = await fetchJson<{ deleted: true }>(
      `/api/knowledge-bases/${kbId}`,
      { method: 'DELETE' },
    )
    return !!res?.deleted
  }

  async function listDocuments(
    kbId: string,
  ): Promise<KnowledgeDocumentDetail[]> {
    documentsLoading.value = true
    try {
      return (
        (await fetchJson<KnowledgeDocumentDetail[]>(
          `/api/knowledge-bases/${kbId}/documents`,
        )) ?? []
      )
    } finally {
      documentsLoading.value = false
    }
  }

  async function uploadDocument(
    kbId: string,
    file: File,
    category?: string,
  ): Promise<KnowledgeDocumentDetail | null> {
    uploading.value = true
    try {
      const form = new FormData()
      form.append('file', file)
      if (category) form.append('category', category)
      const res = await fetch(`/api/knowledge-bases/${kbId}/documents`, {
        method: 'POST',
        body: form,
      }).catch(() => null)
      if (!res?.ok) return null
      return (await res.json()) as KnowledgeDocumentDetail
    } finally {
      uploading.value = false
    }
  }

  async function deleteDocument(kbId: string, docId: string): Promise<boolean> {
    const res = await fetch(`/api/knowledge-bases/${kbId}/documents/${docId}`, {
      method: 'DELETE',
    }).catch(() => null)
    return !!res?.ok
  }

  async function listChunks(
    kbId: string,
    docId: string,
  ): Promise<KnowledgeChunk[]> {
    chunksLoading.value = true
    try {
      return (
        (await fetchJson<KnowledgeChunk[]>(
          `/api/knowledge-bases/${kbId}/documents/${docId}/chunks`,
        )) ?? []
      )
    } finally {
      chunksLoading.value = false
    }
  }

  async function setChunkEnabled(
    kbId: string,
    chunkId: string,
    enabled: boolean,
  ): Promise<boolean> {
    const res = await fetchJson<{ enabled: boolean }>(
      `/api/knowledge-bases/${kbId}/chunks/${chunkId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      },
    )
    return res?.enabled === enabled
  }

  async function searchInKb(
    kbId: string,
    query: string,
    options: Partial<{
      rerank: boolean
      retrievalMode: RetrievalMode
      threshold: number
      stage1TopK: number
      vectorTopK: number
      keywordTopK: number
      finalTopK: number
      fusion: Partial<RetrievalFusionConfig>
      rewrite: boolean
      history: Array<{ role: 'user' | 'assistant'; content: string }>
    }> = {},
  ): Promise<KnowledgeSearchResult | null> {
    const q = query.trim()
    if (!q) return null
    searching.value = true
    try {
      return await fetchJson<KnowledgeSearchResult>(
        `/api/knowledge-bases/${kbId}/search`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: q, ...options }),
        },
      )
    } finally {
      searching.value = false
    }
  }

  async function listKbsForPersona(
    personaId: string,
  ): Promise<KnowledgeBase[]> {
    return (
      (await fetchJson<KnowledgeBase[]>(
        `/api/personas/${personaId}/knowledge-bases`,
      )) ?? []
    )
  }

  async function attachToPersona(
    personaId: string,
    knowledgeBaseId: string,
  ): Promise<boolean> {
    const res = await fetchJson<{ attached: boolean }>(
      `/api/personas/${personaId}/knowledge-bases`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ knowledgeBaseId }),
      },
    )
    return res?.attached === true
  }

  async function detachFromPersona(
    personaId: string,
    kbId: string,
  ): Promise<boolean> {
    const res = await fetch(
      `/api/personas/${personaId}/knowledge-bases/${kbId}`,
      { method: 'DELETE' },
    ).catch(() => null)
    return !!res?.ok
  }

  return {
    listLoading,
    detailLoading,
    documentsLoading,
    chunksLoading,
    searching,
    uploading,
    listAll,
    getById,
    create,
    update,
    remove,
    listDocuments,
    uploadDocument,
    deleteDocument,
    listChunks,
    setChunkEnabled,
    searchInKb,
    listKbsForPersona,
    attachToPersona,
    detachFromPersona,
  }
}
