import { ref } from 'vue'
import { apiJson } from '@/api/client'
import type { NotificationItem, NotificationListResult } from '@/types'

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export function useNotifications() {
  const loading = ref(false)
  const unreadCount = ref(0)

  async function list(query: {
    page?: number
    pageSize?: number
    unreadOnly?: boolean
  } = {}): Promise<NotificationListResult> {
    loading.value = true
    try {
      const result = await apiJson<NotificationListResult>(
        `/api/notifications${toQuery(query)}`,
      )
      unreadCount.value = result?.unreadCount ?? unreadCount.value
      return (
        result ?? {
          items: [],
          total: 0,
          page: query.page ?? 1,
          pageSize: query.pageSize ?? 20,
          unreadCount: unreadCount.value,
        }
      )
    } finally {
      loading.value = false
    }
  }

  async function markRead(id: string): Promise<NotificationItem | null> {
    const item = await apiJson<NotificationItem>(`/api/notifications/${id}/read`, {
      method: 'PATCH',
    })
    if (item) unreadCount.value = Math.max(0, unreadCount.value - 1)
    return item
  }

  async function markAllRead(): Promise<boolean> {
    const result = await apiJson<{ updated: number }>(
      '/api/notifications/read-all',
      { method: 'PATCH' },
    )
    if (result) unreadCount.value = 0
    return !!result
  }

  return {
    loading,
    unreadCount,
    list,
    markRead,
    markAllRead,
  }
}
