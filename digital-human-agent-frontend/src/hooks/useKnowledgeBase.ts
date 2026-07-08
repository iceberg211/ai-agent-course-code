import { ref } from 'vue'
import { apiFetch, apiJson } from '@/api/client'
import type {
  KnowledgeBase,
  ChunkContext,
  DocumentTaskItem,
  KnowledgeChunk,
  KnowledgeDocumentDetail,
  KnowledgeEvalCase,
  KnowledgeGraphOverview,
  KnowledgeSearchResult,
  PaginatedResult,
  RetrievalConfig,
} from '@/types'

export interface CreateKnowledgeBasePayload {
  name: string
  description?: string
  ownerPersonaId?: string
  retrievalConfig?: Partial<RetrievalConfig>
}

export interface UpdateKnowledgeBasePayload
  extends Partial<CreateKnowledgeBasePayload> {}

export interface DocumentListQuery {
  q?: string
  knowledgeBaseId?: string
  fileType?: string
  status?: string
  graphStatus?: string
  processingStage?: string
  tags?: string
  department?: string
  businessCategory?: string
  visibility?: 'private' | 'department' | 'company' | ''
  expiresBefore?: string
  page?: number
  pageSize?: number
}

export interface EvalCasePayload {
  question: string
  expectedAnswer?: string
}

export interface UploadDocumentMetadata {
  category?: string
  tags?: string[]
  department?: string
  businessCategory?: string
  visibility?: 'private' | 'department' | 'company'
  expiresAt?: string
  securityLevel?: number
}

function toQuery(params: object): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
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
      return (await apiJson<KnowledgeBase[]>('/api/knowledge-bases')) ?? []
    } finally {
      listLoading.value = false
    }
  }

  async function getById(kbId: string): Promise<KnowledgeBase | null> {
    detailLoading.value = true
    try {
      return await apiJson<KnowledgeBase>(`/api/knowledge-bases/${kbId}`)
    } finally {
      detailLoading.value = false
    }
  }

  async function create(
    payload: CreateKnowledgeBasePayload,
  ): Promise<KnowledgeBase | null> {
    return apiJson<KnowledgeBase>('/api/knowledge-bases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  async function update(
    kbId: string,
    payload: UpdateKnowledgeBasePayload,
  ): Promise<KnowledgeBase | null> {
    return apiJson<KnowledgeBase>(`/api/knowledge-bases/${kbId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  async function remove(kbId: string): Promise<boolean> {
    const res = await apiJson<{ deleted: true }>(
      `/api/knowledge-bases/${kbId}`,
      { method: 'DELETE' },
    )
    return !!res?.deleted
  }

  async function listDocuments(kbId: string): Promise<KnowledgeDocumentDetail[]> {
    documentsLoading.value = true
    try {
      return (
        (await apiJson<KnowledgeDocumentDetail[]>(
          `/api/knowledge-bases/${kbId}/documents`,
        )) ?? []
      )
    } finally {
      documentsLoading.value = false
    }
  }

  async function listDocumentsPaged(
    kbId: string,
    query: Omit<DocumentListQuery, 'knowledgeBaseId'> = {},
  ): Promise<PaginatedResult<KnowledgeDocumentDetail>> {
    documentsLoading.value = true
    try {
      return (
        (await apiJson<PaginatedResult<KnowledgeDocumentDetail>>(
          `/api/knowledge-bases/${kbId}/documents${toQuery(query)}`,
        )) ?? { items: [], total: 0, page: query.page ?? 1, pageSize: query.pageSize ?? 20 }
      )
    } finally {
      documentsLoading.value = false
    }
  }

  async function listAllDocuments(
    query: DocumentListQuery = {},
  ): Promise<PaginatedResult<KnowledgeDocumentDetail>> {
    documentsLoading.value = true
    try {
      return (
        (await apiJson<PaginatedResult<KnowledgeDocumentDetail>>(
          `/api/documents${toQuery(query)}`,
        )) ?? { items: [], total: 0, page: query.page ?? 1, pageSize: query.pageSize ?? 20 }
      )
    } finally {
      documentsLoading.value = false
    }
  }

  async function uploadDocument(
    kbId: string,
    file: File,
    metadata: UploadDocumentMetadata | string = {},
  ): Promise<KnowledgeDocumentDetail | null> {
    uploading.value = true
    try {
      const form = new FormData()
      form.append('file', file)
      appendUploadMetadata(form, metadata)
      const res = await apiFetch(`/api/knowledge-bases/${kbId}/documents`, {
        method: 'POST',
        body: form,
      }).catch(() => null)
      if (!res?.ok) return null
      return (await res.json()) as KnowledgeDocumentDetail
    } finally {
      uploading.value = false
    }
  }

  async function uploadDocumentWithProgress(
    kbId: string,
    file: File,
    metadata: UploadDocumentMetadata | string = {},
    onProgress?: (percent: number) => void,
  ): Promise<KnowledgeDocumentDetail | null> {
    uploading.value = true
    try {
      const form = new FormData()
      form.append('file', file)
      appendUploadMetadata(form, metadata)
      return await new Promise((resolve) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `/api/knowledge-bases/${kbId}/documents`)
        const token = localStorage.getItem('jwt_token')
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          onProgress?.(Math.round((event.loaded / event.total) * 100))
        }
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            resolve(null)
            return
          }
          try {
            resolve(JSON.parse(xhr.responseText) as KnowledgeDocumentDetail)
          } catch {
            resolve(null)
          }
        }
        xhr.onerror = () => resolve(null)
        xhr.send(form)
      })
    } finally {
      uploading.value = false
    }
  }

  async function uploadDocumentTask(
    kbId: string,
    file: File,
    metadata: UploadDocumentMetadata | string = {},
    onProgress?: (percent: number) => void,
  ): Promise<DocumentTaskItem | null> {
    uploading.value = true
    try {
      const form = new FormData()
      form.append('file', file)
      appendUploadMetadata(form, metadata)
      return await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `/api/knowledge-bases/${kbId}/documents/upload`)
        const token = localStorage.getItem('jwt_token')
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          onProgress?.(Math.round((event.loaded / event.total) * 100))
        }
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            let errorMsg = '上传失败'
            try {
              const res = JSON.parse(xhr.responseText)
              errorMsg = res.message || errorMsg
            } catch {}
            reject(new Error(errorMsg))
            return
          }
          try {
            resolve(JSON.parse(xhr.responseText) as DocumentTaskItem)
          } catch {
            reject(new Error('解析上传响应出错'))
          }
        }
        xhr.onerror = () => reject(new Error('网络错误，无法连接服务器'))
        xhr.send(form)
      })
    } finally {
      uploading.value = false
    }
  }

  async function getDocumentTask(taskId: string): Promise<DocumentTaskItem | null> {
    return apiJson<DocumentTaskItem>(`/api/document-tasks/${taskId}`)
  }

  async function listDocumentTasks(docId: string): Promise<DocumentTaskItem[]> {
    return (await apiJson<DocumentTaskItem[]>(`/api/documents/${docId}/tasks`)) ?? []
  }

  async function deleteDocument(kbId: string, docId: string): Promise<boolean> {
    const res = await apiFetch(
      `/api/knowledge-bases/${kbId}/documents/${docId}`,
      { method: 'DELETE' },
    ).catch(() => null)
    return !!res?.ok
  }

  async function batchRetryDocuments(
    kbId: string,
    documentIds: string[],
  ): Promise<{ success: boolean; results: Array<{ documentId: string; success: boolean; error?: string }> } | null> {
    return apiJson(`/api/knowledge-bases/${kbId}/documents/batch-retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentIds }),
    })
  }

  async function uploadDocumentVersion(
    kbId: string,
    docId: string,
    file: File,
    metadata: UploadDocumentMetadata | string = {},
  ): Promise<KnowledgeDocumentDetail | null> {
    const form = new FormData()
    form.append('file', file)
    appendUploadMetadata(form, metadata)
    const res = await apiFetch(
      `/api/knowledge-bases/${kbId}/documents/${docId}/versions`,
      { method: 'POST', body: form },
    ).catch(() => null)
    if (!res?.ok) return null
    return (await res.json()) as KnowledgeDocumentDetail
  }

  async function listDocumentVersions(
    kbId: string,
    docId: string,
  ): Promise<KnowledgeDocumentDetail[]> {
    return (
      (await apiJson<KnowledgeDocumentDetail[]>(
        `/api/knowledge-bases/${kbId}/documents/${docId}/versions`,
      )) ?? []
    )
  }

  async function setCurrentDocumentVersion(
    kbId: string,
    docId: string,
  ): Promise<KnowledgeDocumentDetail | null> {
    return apiJson<KnowledgeDocumentDetail>(
      `/api/knowledge-bases/${kbId}/documents/${docId}/current-version`,
      { method: 'PATCH' },
    )
  }

  async function archiveDocument(
    kbId: string,
    docId: string,
  ): Promise<KnowledgeDocumentDetail | null> {
    return apiJson<KnowledgeDocumentDetail>(
      `/api/knowledge-bases/${kbId}/documents/${docId}/archive`,
      { method: 'PATCH' },
    )
  }

  async function updateDocumentGovernance(
    kbId: string,
    docId: string,
    metadata: UploadDocumentMetadata,
  ): Promise<KnowledgeDocumentDetail | null> {
    return apiJson<KnowledgeDocumentDetail>(
      `/api/knowledge-bases/${kbId}/documents/${docId}/governance`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...metadata,
          tags: metadata.tags?.join(','),
        }),
      },
    )
  }

  async function retryDocument(
    kbId: string,
    docId: string,
  ): Promise<KnowledgeDocumentDetail | null> {
    return apiJson<KnowledgeDocumentDetail>(
      `/api/knowledge-bases/${kbId}/documents/${docId}/retry`,
      { method: 'POST' },
    )
  }

  async function listChunks(
    kbId: string,
    docId: string,
  ): Promise<KnowledgeChunk[]> {
    chunksLoading.value = true
    try {
      return (
        (await apiJson<KnowledgeChunk[]>(
          `/api/knowledge-bases/${kbId}/documents/${docId}/chunks`,
        )) ?? []
      )
    } finally {
      chunksLoading.value = false
    }
  }

  async function listDocumentAssets(
    kbId: string,
    docId: string,
  ): Promise<any[]> {
    return (await apiJson<any[]>(`/api/knowledge-bases/${kbId}/documents/${docId}/assets`)) ?? []
  }

  async function getDocumentMarkdown(
    kbId: string,
    docId: string,
  ): Promise<{ markdown: string } | null> {
    return await apiJson<{ markdown: string }>(`/api/knowledge-bases/${kbId}/documents/${docId}/markdown`)
  }

  async function setChunkEnabled(
    kbId: string,
    chunkId: string,
    enabled: boolean,
  ): Promise<boolean> {
    const res = await apiJson<{ enabled: boolean }>(
      `/api/knowledge-bases/${kbId}/chunks/${chunkId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      },
    )
    return res?.enabled === enabled
  }

  async function getChunkContext(
    kbId: string,
    docId: string,
    chunkId: string,
    before = 1,
    after = 1,
  ): Promise<ChunkContext | null> {
    return apiJson<ChunkContext>(
      `/api/knowledge-bases/${kbId}/documents/${docId}/chunks/${chunkId}/context${toQuery({ before, after })}`,
    )
  }

  async function searchInKb(
    kbId: string,
    query: string,
    options: Partial<{
      rerank: boolean
      threshold: number
      stage1TopK: number
      finalTopK: number
      useGraph: boolean
    }> = {},
  ): Promise<KnowledgeSearchResult | null> {
    const q = query.trim()
    if (!q) return null
    searching.value = true
    try {
      return await apiJson<KnowledgeSearchResult>(
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

  async function searchForPersonaWithStages(
    personaId: string,
    query: string,
    options: Partial<{
      rerank: boolean
      threshold: number
      stage1TopK: number
      finalTopK: number
      useGraph: boolean
    }> = {},
  ): Promise<KnowledgeSearchResult | null> {
    const q = query.trim()
    if (!q || !personaId) return null
    searching.value = true
    try {
      return await apiJson<KnowledgeSearchResult>(
        `/api/personas/${personaId}/search/stages`,
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

  async function searchAcrossKnowledgeBases(
    query: string,
    options: Partial<{
      knowledgeBaseIds: string[]
      rerank: boolean
      threshold: number
      stage1TopK: number
      finalTopK: number
      useGraph: boolean
      fileType: string
      tags: string | string[]
      department: string
      businessCategory: string
      visibility: string
    }> = {},
  ): Promise<KnowledgeSearchResult | null> {
    const q = query.trim()
    if (!q) return null
    searching.value = true
    try {
      const payload = {
        ...options,
        tags: normalizeTagsOption(options.tags),
      }
      return await apiJson<KnowledgeSearchResult>('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, ...payload }),
      })
    } finally {
      searching.value = false
    }
  }

  async function listEvalCases(kbId: string): Promise<KnowledgeEvalCase[]> {
    return (
      (await apiJson<KnowledgeEvalCase[]>(
        `/api/knowledge-bases/${kbId}/eval-cases`,
      )) ?? []
    )
  }

  async function createEvalCase(
    kbId: string,
    payload: EvalCasePayload,
  ): Promise<KnowledgeEvalCase | null> {
    return apiJson<KnowledgeEvalCase>(
      `/api/knowledge-bases/${kbId}/eval-cases`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
  }

  async function updateEvalCase(
    kbId: string,
    evalCaseId: string,
    payload: Partial<EvalCasePayload>,
  ): Promise<KnowledgeEvalCase | null> {
    return apiJson<KnowledgeEvalCase>(
      `/api/knowledge-bases/${kbId}/eval-cases/${evalCaseId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
  }

  async function deleteEvalCase(
    kbId: string,
    evalCaseId: string,
  ): Promise<boolean> {
    const res = await apiJson<{ deleted: true }>(
      `/api/knowledge-bases/${kbId}/eval-cases/${evalCaseId}`,
      { method: 'DELETE' },
    )
    return res?.deleted === true
  }

  async function runEvalBatch(kbId: string): Promise<KnowledgeEvalCase[]> {
    return (
      (await apiJson<KnowledgeEvalCase[]>(
        `/api/knowledge-bases/${kbId}/eval-cases/run-batch`,
        { method: 'POST' },
      )) ?? []
    )
  }

  async function runEvalCase(
    kbId: string,
    evalCaseId: string,
  ): Promise<KnowledgeEvalCase | null> {
    return apiJson<KnowledgeEvalCase>(
      `/api/knowledge-bases/${kbId}/eval-cases/${evalCaseId}/run`,
      { method: 'POST' },
    )
  }

  async function updateEvalReview(
    kbId: string,
    evalCaseId: string,
    status: 'passed' | 'failed' | 'unreviewed',
  ): Promise<KnowledgeEvalCase | null> {
    return apiJson<KnowledgeEvalCase>(
      `/api/knowledge-bases/${kbId}/eval-cases/${evalCaseId}/review`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      },
    )
  }

  async function listKbsForPersona(personaId: string): Promise<KnowledgeBase[]> {
    return (
      (await apiJson<KnowledgeBase[]>(
        `/api/personas/${personaId}/knowledge-bases`,
      )) ?? []
    )
  }

  async function attachToPersona(
    personaId: string,
    knowledgeBaseId: string,
  ): Promise<boolean> {
    const res = await apiJson<{ attached: boolean }>(
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
    const res = await apiFetch(
      `/api/personas/${personaId}/knowledge-bases/${kbId}`,
      { method: 'DELETE' },
    ).catch(() => null)
    return !!res?.ok
  }

  async function listGraphEntities(kbId: string, q = '', limit = 50): Promise<any[]> {
    return (await apiJson<any[]>(`/api/knowledge-bases/${kbId}/graph/entities?q=${encodeURIComponent(q)}&limit=${limit}`)) ?? []
  }

  async function listGraphRelations(kbId: string, limit = 100): Promise<any[]> {
    return (await apiJson<any[]>(`/api/knowledge-bases/${kbId}/graph/relations?limit=${limit}`)) ?? []
  }

  async function getGraphNeighborhood(kbId: string, nodeKey: string): Promise<any[]> {
    return (await apiJson<any[]>(`/api/knowledge-bases/${kbId}/graph/neighborhood?nodeKey=${encodeURIComponent(nodeKey)}`)) ?? []
  }

  async function getGraphOverview(kbId: string, limit = 120): Promise<KnowledgeGraphOverview> {
    return (
      (await apiJson<KnowledgeGraphOverview>(
        `/api/knowledge-bases/${kbId}/graph/overview?limit=${limit}`,
      )) ?? {
        nodes: [],
        edges: [],
        stats: {
          nodeCount: 0,
          edgeCount: 0,
          visibleChunkCount: 0,
          enabled: false,
        },
      }
    )
  }

  async function rebuildGraph(kbId: string): Promise<{ success: boolean; message?: string }> {
    return (await apiJson<any>(`/api/knowledge-bases/${kbId}/graph/rebuild`, { method: 'POST' })) ?? { success: false }
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
    listDocumentsPaged,
    listAllDocuments,
    uploadDocument,
    uploadDocumentWithProgress,
    uploadDocumentTask,
    getDocumentTask,
    listDocumentTasks,
    deleteDocument,
    retryDocument,
    batchRetryDocuments,
    uploadDocumentVersion,
    listDocumentVersions,
    setCurrentDocumentVersion,
    archiveDocument,
    updateDocumentGovernance,
    listChunks,
    listDocumentAssets,
    getDocumentMarkdown,
    setChunkEnabled,
    getChunkContext,
    searchInKb,
    searchForPersonaWithStages,
    searchAcrossKnowledgeBases,
    listEvalCases,
    createEvalCase,
    updateEvalCase,
    deleteEvalCase,
    runEvalBatch,
    runEvalCase,
    updateEvalReview,
    listKbsForPersona,
    attachToPersona,
    detachFromPersona,
    listGraphEntities,
    listGraphRelations,
    getGraphNeighborhood,
    getGraphOverview,
    rebuildGraph,
  }
}

function normalizeTagsOption(tags?: string | string[]): string[] | undefined {
  if (Array.isArray(tags)) {
    const list = tags.map((tag) => tag.trim()).filter(Boolean)
    return list.length > 0 ? list : undefined
  }
  if (typeof tags === 'string') {
    const list = tags.split(',').map((tag) => tag.trim()).filter(Boolean)
    return list.length > 0 ? list : undefined
  }
  return undefined
}

function appendUploadMetadata(
  form: FormData,
  metadata: UploadDocumentMetadata | string,
) {
  if (typeof metadata === 'string') {
    if (metadata) form.append('category', metadata)
    return
  }
  if (metadata.category) form.append('category', metadata.category)
  if (metadata.tags?.length) form.append('tags', metadata.tags.join(','))
  if (metadata.department) form.append('department', metadata.department)
  if (metadata.businessCategory) {
    form.append('businessCategory', metadata.businessCategory)
  }
  if (metadata.visibility) form.append('visibility', metadata.visibility)
  if (metadata.expiresAt) form.append('expiresAt', metadata.expiresAt)
  if (metadata.securityLevel != null) {
    form.append('securityLevel', String(metadata.securityLevel))
  }
}
