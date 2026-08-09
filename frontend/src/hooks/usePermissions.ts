import { computed, ref } from 'vue'
import { apiJson } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

interface PermissionSnapshot {
  permissions?: string[]
  roles?: string[]
}

const permissions = ref<string[]>([])
const loading = ref(false)
const loaded = ref(false)

function allows(list: string[], code: string): boolean {
  if (!code) return true
  if (list.includes('*') || list.includes(code)) return true
  const [resource] = code.split(':')
  return list.includes(`${resource}:*`)
}

export function usePermissions() {
  const authStore = useAuthStore()

  async function loadPermissions(force = false): Promise<string[]> {
    if (loaded.value && !force) return permissions.value
    if (loading.value) return permissions.value
    loading.value = true
    try {
      const snapshot = await apiJson<PermissionSnapshot>('/api/rbac/me/permissions')
      permissions.value = snapshot?.permissions ?? []
      loaded.value = true
      return permissions.value
    } finally {
      loading.value = false
    }
  }

  function can(code: string): boolean {
    if (authStore.user?.role === 'admin') return true
    return allows(permissions.value, code)
  }

  function canAny(codes: string[]): boolean {
    return codes.some((code) => can(code))
  }

  return {
    permissions: computed(() => permissions.value),
    loading,
    loaded,
    loadPermissions,
    can,
    canAny,
  }
}
