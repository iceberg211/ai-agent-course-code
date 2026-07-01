import { ref } from 'vue'
import { apiFetch, apiJson } from '@/api/client'
import type {
  PaginatedResult,
  RbacDepartmentItem,
  RbacPermissionItem,
  RbacRoleItem,
  RbacUserItem,
} from '@/types'

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export function useRbac() {
  const loading = ref(false)

  async function listRoles(): Promise<RbacRoleItem[]> {
    return (await apiJson<RbacRoleItem[]>('/api/rbac/roles')) ?? []
  }

  async function listPermissions(): Promise<RbacPermissionItem[]> {
    return (await apiJson<RbacPermissionItem[]>('/api/rbac/permissions')) ?? []
  }

  async function listUsers(query: {
    q?: string
    role?: string
    department?: string
    page?: number
    pageSize?: number
  } = {}): Promise<PaginatedResult<RbacUserItem>> {
    loading.value = true
    try {
      return (
        (await apiJson<PaginatedResult<RbacUserItem>>(
          `/api/rbac/users${toQuery(query)}`,
        )) ?? { items: [], total: 0, page: query.page ?? 1, pageSize: query.pageSize ?? 20 }
      )
    } finally {
      loading.value = false
    }
  }

  async function listDepartments(): Promise<RbacDepartmentItem[]> {
    return (await apiJson<RbacDepartmentItem[]>('/api/rbac/departments')) ?? []
  }

  async function assignUserRoles(userId: string, roleCodes: string[]): Promise<boolean> {
    const res = await apiJson<{ userId: string; roleCodes: string[] }>(
      `/api/rbac/users/${userId}/roles`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roleCodes }),
      },
    )
    return !!res
  }

  async function updateUserDepartment(userId: string, department: string | null): Promise<boolean> {
    const res = await apiJson<RbacUserItem>(
      `/api/rbac/users/${userId}/department`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ department }),
      },
    )
    return !!res
  }

  async function createDepartment(payload: { code: string; name: string; parentId?: string | null }) {
    return apiJson<RbacDepartmentItem>('/api/rbac/departments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  async function deleteDepartment(id: string): Promise<boolean> {
    const res = await apiFetch(`/api/rbac/departments/${id}`, { method: 'DELETE' }).catch(() => null)
    return !!res?.ok
  }

  return {
    loading,
    listRoles,
    listPermissions,
    listUsers,
    listDepartments,
    assignUserRoles,
    updateUserDepartment,
    createDepartment,
    deleteDepartment,
  }
}
