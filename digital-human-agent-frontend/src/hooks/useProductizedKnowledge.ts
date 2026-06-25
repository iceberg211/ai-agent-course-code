import { ref } from 'vue'
import type {
  ChatMessage,
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

  return {
    loading,
    getDashboardSummary,
    listConversations,
    listConversationMessages,
    setMessageFeedback,
    deleteConversation,
  }
}
