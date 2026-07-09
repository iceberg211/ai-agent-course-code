<template>
  <main class="p-6 h-full overflow-y-auto bg-transparent flex flex-col gap-6 w-full text-left">
    <PageHeader
      eyebrow="安全治理"
      title="个人中心"
      description="管理个人访问凭证、部门范围、API Key 与账户安全配置。"
    />

    <div class="w-full grid grid-cols-12 gap-6">
      <div class="col-span-12 lg:col-span-4 flex flex-col gap-6">
        <section class="flex items-center gap-5 p-6 bg-white/65 backdrop-blur-md border border-white/50 rounded-xl">
          <div class="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xl font-extrabold shrink-0">
            {{ initial }}
          </div>
          <div class="flex flex-col gap-1">
            <h3 class="text-base font-extrabold text-text-main m-0">{{ username }}</h3>
            <p class="inline-block self-start px-2 py-0.5 bg-primary-bg text-primary text-[10px] font-bold rounded-[6px] m-0">
              企业知识管理员
            </p>
            <span class="text-xs text-text-muted">系统角色：{{ roleCodes }}</span>
          </div>
        </section>
        <ProfileSecurityCard @reset-cache="resetLocalCache" @logout="requestLogout" />
      </div>

      <div class="col-span-12 lg:col-span-8 flex flex-col gap-6">
        <section class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 flex flex-col gap-4">
          <div>
            <h4 class="text-[14.5px] font-bold text-text-main m-0">我的访问能力</h4>
            <p class="text-xs text-text-muted mt-1 m-0">这些信息会影响文档列表、搜索、问答引用和按钮级操作权限。</p>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <MetricCard
              v-for="item in accessSummary"
              :key="item.label"
              :label="item.label"
              :value="item.value"
              :hint="item.hint"
            />
          </div>
        </section>

        <div class="grid grid-cols-12 gap-6">
          <section class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 col-span-12 lg:col-span-6 flex flex-col gap-5">
            <div>
              <h4 class="text-[14.5px] font-bold text-text-main m-0">数据访问凭证</h4>
              <p class="text-xs text-text-muted mt-1 m-0">这些凭证用于在后端物理隔离您的知识与记录。</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <span class="text-xs font-bold text-text-secondary">当前用户标识 (Owner ID)</span>
              <div class="flex items-center justify-between h-10 px-3 border border-border-main rounded-lg bg-gray-50">
                <code class="font-mono text-xs text-text-main">{{ ownerId }}</code>
                <button class="bg-transparent border border-border-main rounded-md px-2.5 py-1 text-[11px] font-bold text-text-secondary cursor-pointer hover:text-primary" type="button" @click="copyId">
                  复制
                </button>
              </div>
            </div>
          </section>

          <section class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 col-span-12 lg:col-span-6 flex flex-col gap-5">
            <div>
              <h4 class="text-[14.5px] font-bold text-text-main m-0">部门信息</h4>
              <p class="text-xs text-text-muted mt-1 m-0">部门会用于判断“部门可见”文档的检索范围。</p>
            </div>
            <form class="flex flex-col gap-3" @submit.prevent="saveDepartment">
              <input
                v-model="departmentInput"
                type="text"
                class="w-full h-10 px-3 border border-border-main rounded-lg text-xs outline-none focus:border-primary"
                placeholder="例如 财务部、产品研发部"
                :disabled="profileLoading"
              />
              <button
                class="self-start h-10 px-4 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer disabled:opacity-60"
                type="submit"
                :disabled="profileLoading"
              >
                保存
              </button>
            </form>
          </section>
        </div>

        <ProfileApiKeyPanel
          :api-keys="apiKeys"
          :loading="apiKeyLoading"
          :created-plain-key="createdPlainKey"
          @create="createApiKey"
          @revoke="requestRevokeApiKey"
          @copy="copyApiKey"
        />

        <ProfileMemoryPanel
          :memories="memories"
          :loading="memoryLoading"
          :search-query="memorySearchQuery"
          @create="handleCreateMemory"
          @delete="requestDeleteMemory"
          @search="onMemorySearch"
        />

        <ProfilePasswordPanel
          v-model:old-password="passwordForm.oldPassword"
          v-model:new-password="passwordForm.newPassword"
          v-model:confirm-password="passwordForm.confirmPassword"
          :loading="loading"
          :error-msg="errorMsg"
          @submit="handleChangePassword"
        />
      </div>
    </div>

    <ConfirmDialog
      :open="confirmOpen"
      :title="confirmTitle"
      :description="confirmDescription"
      :danger="confirmDanger"
      :loading="confirmLoading"
      @confirm="runConfirm"
      @cancel="confirmOpen = false"
    />

    <ToastAlert :message="toastMsg" />
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { apiFetch, apiJson } from '@/api/client'
import { useProductizedKnowledge } from '@/hooks/useProductizedKnowledge'
import PageHeader from '@/components/common/PageHeader.vue'
import MetricCard from '@/components/common/MetricCard.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ToastAlert from '@/components/common/ToastAlert.vue'
import ProfileApiKeyPanel from '@/components/profile/ProfileApiKeyPanel.vue'
import ProfileMemoryPanel from '@/components/profile/ProfileMemoryPanel.vue'
import ProfilePasswordPanel from '@/components/profile/ProfilePasswordPanel.vue'
import ProfileSecurityCard from '@/components/profile/ProfileSecurityCard.vue'
import type { ApiKeyItem } from '@/types'

const router = useRouter()
const authStore = useAuthStore()
const { listMemories, createMemory, deleteMemory } = useProductizedKnowledge()

const loading = ref(false)
const errorMsg = ref('')
const toastMsg = ref('')
const apiKeyLoading = ref(false)
const profileLoading = ref(false)
const apiKeys = ref<ApiKeyItem[]>([])
const createdPlainKey = ref('')
const departmentInput = ref('')
const memories = ref<any[]>([])
const memoryLoading = ref(false)
const memorySearchQuery = ref('')
const passwordForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

const confirmOpen = ref(false)
const confirmTitle = ref('')
const confirmDescription = ref('')
const confirmDanger = ref(false)
const confirmLoading = ref(false)
let confirmAction: (() => Promise<void>) | null = null

const initial = computed(() => (authStore.user?.username || '管').slice(0, 1).toUpperCase())
const username = computed(() => authStore.user?.username || '企业管理员')
const ownerId = computed(() => authStore.user?.id || '无凭证')
const roleCodes = computed(() => {
  const user = authStore.user as typeof authStore.user & { roleCodes?: string[]; roles?: string[]; role?: string }
  const values = user?.roleCodes ?? user?.roles ?? (user?.role ? [user.role] : [])
  return values.length ? values.join('、') : '未分配'
})
const accessSummary = computed(() => [
  { label: '当前部门', value: authStore.user?.department || departmentInput.value || '未设置', hint: '用于部门可见资料过滤' },
  { label: '角色权限', value: roleCodes.value, hint: '影响页面、菜单和按钮权限' },
  { label: 'API Key', value: `${apiKeys.value.filter((item) => item.isActive).length} 个有效`, hint: '用于服务端和脚本调用' },
  { label: '数据范围', value: 'Owner / Department / Company', hint: '搜索和问答默认按范围过滤' },
])

onMounted(() => {
  void loadProfile()
  void loadApiKeys()
  void loadMemories()
})

function showToast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => {
    toastMsg.value = ''
  }, 2500)
}

function openConfirm(options: {
  title: string
  description: string
  danger?: boolean
  action: () => Promise<void>
}) {
  confirmTitle.value = options.title
  confirmDescription.value = options.description
  confirmDanger.value = options.danger ?? false
  confirmAction = options.action
  confirmOpen.value = true
}

async function runConfirm() {
  if (!confirmAction) return
  confirmLoading.value = true
  try {
    await confirmAction()
    confirmOpen.value = false
  } finally {
    confirmLoading.value = false
    confirmAction = null
  }
}

function copyId() {
  if (!ownerId.value || ownerId.value === '无凭证') return
  void navigator.clipboard.writeText(ownerId.value)
  showToast('用户凭证已成功复制到剪贴板。')
}

async function loadApiKeys() {
  apiKeyLoading.value = true
  try {
    apiKeys.value = (await apiJson<ApiKeyItem[]>('/api/auth/api-keys')) ?? []
  } finally {
    apiKeyLoading.value = false
  }
}

async function loadProfile() {
  profileLoading.value = true
  try {
    const profile = await apiJson<typeof authStore.user>('/api/auth/me')
    if (profile) {
      authStore.user = profile
      localStorage.setItem('user_info', JSON.stringify(profile))
      departmentInput.value = profile.department ?? ''
    }
  } finally {
    profileLoading.value = false
  }
}

async function saveDepartment() {
  profileLoading.value = true
  try {
    const profile = await apiJson<typeof authStore.user>('/api/auth/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ department: departmentInput.value.trim() }),
    })
    if (!profile) {
      showToast('部门保存失败')
      return
    }
    authStore.user = profile
    localStorage.setItem('user_info', JSON.stringify(profile))
    showToast('部门信息已保存')
  } finally {
    profileLoading.value = false
  }
}

async function createApiKey(name: string) {
  apiKeyLoading.value = true
  try {
    const created = await apiJson<ApiKeyItem>('/api/auth/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!created?.key) {
      showToast('API Key 创建失败')
      return
    }
    createdPlainKey.value = created.key
    showToast('API Key 已创建')
    await loadApiKeys()
  } finally {
    apiKeyLoading.value = false
  }
}

function requestRevokeApiKey(id: string) {
  openConfirm({
    title: '废弃 API Key',
    description: '确定废弃这个 API Key 吗？已接入的调用会立即失效。',
    danger: true,
    action: async () => {
      apiKeyLoading.value = true
      try {
        const res = await apiFetch(`/api/auth/api-keys/${id}`, { method: 'DELETE' }).catch(() => null)
        if (!res?.ok) {
          showToast('API Key 废弃失败')
          return
        }
        showToast('API Key 已废弃')
        await loadApiKeys()
      } finally {
        apiKeyLoading.value = false
      }
    },
  })
}

function copyApiKey(value: string) {
  void navigator.clipboard.writeText(value)
  showToast('API Key 已复制到剪贴板。')
}

async function loadMemories() {
  memoryLoading.value = true
  try {
    memories.value = await listMemories(memorySearchQuery.value)
  } finally {
    memoryLoading.value = false
  }
}

function onMemorySearch(query: string) {
  memorySearchQuery.value = query
  void loadMemories()
}

async function handleCreateMemory(content: string) {
  memoryLoading.value = true
  try {
    const res = await createMemory(content)
    if (res) {
      showToast('长期记忆事实已记录')
      await loadMemories()
    }
  } finally {
    memoryLoading.value = false
  }
}

function requestDeleteMemory(id: string) {
  openConfirm({
    title: '抹除长期记忆',
    description: '确定抹除这段 AI 长期记忆吗？抹除后 AI 将不再遵循此偏好。',
    danger: true,
    action: async () => {
      memoryLoading.value = true
      try {
        const ok = await deleteMemory(id)
        if (ok) {
          showToast('长期记忆已抹除')
          await loadMemories()
        }
      } finally {
        memoryLoading.value = false
      }
    },
  })
}

function resetLocalCache() {
  openConfirm({
    title: '清除本地缓存',
    description: '确定清空本地缓存吗？这会清除本地保存的 RAG 检索草稿。',
    danger: true,
    action: async () => {
      localStorage.removeItem('__draft_rag_search')
      localStorage.removeItem('vuex')
      showToast('本地临时缓存已成功清除。')
    },
  })
}

function requestLogout() {
  openConfirm({
    title: '安全退出登录',
    description: '确定退出当前登录吗？',
    danger: false,
    action: async () => {
      authStore.logout()
      router.push('/login')
    },
  })
}

async function handleChangePassword() {
  const oldPwd = passwordForm.oldPassword.trim()
  const newPwd = passwordForm.newPassword.trim()
  const confirmPwd = passwordForm.confirmPassword.trim()
  if (newPwd.length < 6) {
    errorMsg.value = '新密码长度至少为 6 位'
    return
  }
  if (newPwd !== confirmPwd) {
    errorMsg.value = '两次输入的新密码不一致'
    return
  }
  errorMsg.value = ''
  loading.value = true
  try {
    const res = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      errorMsg.value = data.message || '修改失败，请检查旧密码是否正确'
      return
    }
    showToast('密码修改成功！请使用新密码重新登录')
    setTimeout(() => {
      authStore.logout()
      router.push('/login')
    }, 1800)
  } catch {
    errorMsg.value = '网络错误，请稍后再试'
  } finally {
    loading.value = false
  }
}
</script>
