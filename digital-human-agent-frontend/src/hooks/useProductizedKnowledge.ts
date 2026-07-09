import { ref } from 'vue'
import type {
  ChatMessage,
  DashboardRagHealth,
  ConversationSummary,
  DashboardSummary,
  PaginatedResult,
} from '@/types'
import { apiJson } from '@/api/client'

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export function useProductizedKnowledge() {
  const loading = ref(false)

  async function getDashboardSummary(): Promise<DashboardSummary | null> {
    loading.value = true
    try {
      return await apiJson<DashboardSummary>('/api/dashboard/summary')
    } finally {
      loading.value = false
    }
  }

  async function getDashboardRagHealth(): Promise<DashboardRagHealth | null> {
    loading.value = true
    try {
      return await apiJson<DashboardRagHealth>('/api/dashboard/rag-health')
    } finally {
      loading.value = false
    }
  }

  async function listConversations(query: {
    personaId?: string
    ownerId?: string
    page?: number
    pageSize?: number
  } = {}): Promise<PaginatedResult<ConversationSummary>> {
    loading.value = true
    try {
      return (
        (await apiJson<PaginatedResult<ConversationSummary>>(
          `/api/conversations${toQuery(query)}`,
        )) ?? { items: [], total: 0, page: query.page ?? 1, pageSize: query.pageSize ?? 20 }
      )
    } finally {
      loading.value = false
    }
  }

  async function listConversationMessages(
    conversationId: string,
  ): Promise<ChatMessage[]> {
    return (
      (await apiJson<ChatMessage[]>(
        `/api/conversations/${conversationId}/messages`,
      )) ?? []
    )
  }

  async function setMessageFeedback(
    conversationId: string,
    messageId: string,
    feedback: 'up' | 'down' | null,
  ): Promise<boolean> {
    const res = await apiJson<ChatMessage>(
      `/api/conversations/${conversationId}/messages/${messageId}/feedback`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback }),
      },
    )
    return !!res
  }

  async function deleteConversation(conversationId: string): Promise<boolean> {
    const res = await apiJson<{ deleted: boolean }>(
      `/api/conversations/${conversationId}`,
      { method: 'DELETE' },
    )
    return res?.deleted === true
  }

  async function getSystemHealth(): Promise<any> {
    return apiJson<any>('/api/health')
  }

  async function listMemories(q?: string): Promise<any[]> {
    loading.value = true
    try {
      const url = q ? `/api/memories?q=${encodeURIComponent(q)}` : '/api/memories'
      return (await apiJson<any[]>(url)) ?? []
    } finally {
      loading.value = false
    }
  }

  async function createMemory(content: string): Promise<any> {
    loading.value = true
    try {
      return await apiJson<any>('/api/memories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, category: 'preference', visibility: 'private' }),
      })
    } finally {
      loading.value = false
    }
  }

  async function deleteMemory(id: string): Promise<boolean> {
    loading.value = true
    try {
      const res = await apiJson<{ deleted: boolean }>(`/api/memories/${id}`, {
        method: 'DELETE',
      })
      return res?.deleted === true
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    getDashboardSummary,
    getDashboardRagHealth,
    listConversations,
    listConversationMessages,
    setMessageFeedback,
    deleteConversation,
    getSystemHealth,
    listMemories,
    createMemory,
    deleteMemory,
  }
}
