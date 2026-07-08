<template>
  <main class="p-6 h-full overflow-y-auto bg-transparent flex flex-col gap-6 w-full text-left">
    <header class="flex items-center justify-between gap-5">
      <div>
        <h2 class="text-xl font-extrabold text-text-main tracking-tight">个人中心</h2>
        <p class="text-xs text-text-muted mt-1">管理您的个人访问凭证、修改密码与系统配置</p>
      </div>
    </header>

    <div class="w-full grid grid-cols-12 gap-6">
      <!-- 左栏：个人名片与安全清理 (占 col-4) -->
      <div class="col-span-12 lg:col-span-4 flex flex-col gap-6">
        <!-- 个人名片 -->
        <section class="flex items-center gap-5 p-6 bg-white/65 backdrop-blur-md border border-white/50 rounded-xl shadow-[0_4px_20px_rgba(15,23,42,0.02),inset_0_1px_0_rgba(255,255,255,0.6)]" aria-label="个人信息">
          <div class="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xl font-extrabold shadow-[0_8px_24px_rgba(37,99,235,0.15)] flex-shrink-0">
            <span>{{ initial }}</span>
          </div>
          <div class="flex flex-col gap-1">
            <h3 class="text-base font-extrabold text-text-main">{{ username }}</h3>
            <p class="inline-block self-start px-2 py-0.5 bg-primary-bg text-primary text-[10px] font-bold rounded-[6px] my-0.5">企业知识管理员</p>
            <span class="text-xs text-text-muted">系统角色：RAG & 数字人代理管理员</span>
          </div>
        </section>

        <!-- 危险与管理区域 -->
        <section class="bg-red-500/5 backdrop-blur-md border border-red-200 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02)] flex flex-col gap-5">
          <div class="text-left">
            <h4 class="text-[14.5px] font-bold text-red-600">敏感数据与账户安全</h4>
            <p class="text-xs text-text-muted mt-1">清空本地配置或安全退出当前系统。</p>
          </div>

          <div class="flex flex-col gap-5">
            <div class="flex flex-col items-start gap-2">
              <button class="inline-flex items-center gap-1.5 px-4 py-2.5 bg-red-600 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-[0_2px_4px_rgba(220,38,38,0.1)] transition-all hover:brightness-108" type="button" @click="resetLocalCache">
                <Trash2Icon :size="14" />
                清除浏览器本地缓存
              </button>
              <p class="text-xs text-text-muted leading-relaxed">重置浏览器中临时保存的 RAG 检索草稿和数字人本地配置参数。</p>
            </div>

            <div class="flex flex-col items-start gap-2 border-t border-red-500/10 pt-5">
              <button class="inline-flex items-center gap-1.5 px-4 py-2.5 bg-amber-600 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-[0_2px_4px_rgba(217,119,6,0.1)] transition-all hover:brightness-108" type="button" @click="handleLogout">
                <LogOutIcon :size="14" />
                安全退出登录
              </button>
              <p class="text-xs text-text-muted leading-relaxed">退出并清空当前用户的访问状态，返回至系统登录页。</p>
            </div>
          </div>
        </section>
      </div>

      <!-- 右栏：凭证、部门、API Key 和 密码修改 (占 col-8) -->
      <div class="col-span-12 lg:col-span-8 flex flex-col gap-6">
        <!-- 子格：凭证与部门并排 (各自占 col-6) -->
        <div class="grid grid-cols-12 gap-6 w-full">
          <!-- 数据访问凭证 -->
          <section class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02),inset_0_1px_0_rgba(255,255,255,0.6)] col-span-12 lg:col-span-6 flex flex-col gap-5">
            <div>
              <h4 class="text-[14.5px] font-bold text-text-main">数据访问凭证</h4>
              <p class="text-xs text-text-muted mt-1">这些凭证用于在后端物理隔离您的知识与记录。</p>
            </div>

            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <span class="text-xs font-bold text-text-secondary">当前用户标识 (Owner ID)</span>
                <div class="flex items-center justify-between h-10 px-3 border border-border-main rounded-lg bg-gray-50">
                  <code class="font-mono text-xs text-text-main">{{ ownerId }}</code>
                  <button class="bg-transparent border border-border-main rounded-md px-2.5 py-1 text-[11px] font-bold text-text-secondary cursor-pointer hover:bg-white hover:text-primary hover:border-primary-muted" type="button" @click="copyId">复制</button>
                </div>
              </div>
            </div>

            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <span class="text-xs font-bold text-text-secondary">数据隔离级别</span>
                <div class="flex items-center justify-between h-10 px-3 border border-border-main rounded-lg bg-gray-50 text-[12.5px] text-text-secondary font-semibold">
                  <span>租户独立隔离 (Client Isolation)</span>
                </div>
              </div>
            </div>
          </section>

          <!-- 部门信息 -->
          <section class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02),inset_0_1px_0_rgba(255,255,255,0.6)] col-span-12 lg:col-span-6 flex flex-col gap-5">
            <div>
              <h4 class="text-[14.5px] font-bold text-text-main">部门信息</h4>
              <p class="text-xs text-text-muted mt-1">部门会用于判断“部门可见”文档的检索范围。</p>
            </div>
            <form class="flex flex-col gap-3" @submit.prevent="saveDepartment">
              <div class="flex flex-col gap-1.5 text-left">
                <label for="dept-input" class="text-xs font-bold text-text-secondary">当前所属部门</label>
                <input
                  id="dept-input"
                  v-model="departmentInput"
                  type="text"
                  class="w-full h-10 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary focus:ring-3 focus:ring-border-focus transition-all"
                  placeholder="例如 财务部、产品研发部"
                  :disabled="profileLoading"
                />
              </div>
              <button class="inline-flex items-center justify-center gap-1.5 h-10 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-[0_4px_12px_rgba(99,102,241,0.2)] transition-all hover:brightness-104 hover:-translate-y-[0.5px] hover:shadow-[0_6px_16px_rgba(99,102,241,0.3)] disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none mt-2.5 self-start px-4" type="submit" :disabled="profileLoading">
                保存
              </button>
            </form>
          </section>
        </div>

        <!-- API Key 管理 -->
        <section class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02),inset_0_1px_0_rgba(255,255,255,0.6)] flex flex-col gap-5">
          <div>
            <h4 class="text-[14.5px] font-bold text-text-main">API Key 管理</h4>
            <p class="text-xs text-text-muted mt-1">用于脚本、服务端任务或内部系统调用知识库与问答接口。</p>
          </div>

          <form class="grid grid-cols-[1fr_auto] gap-2.5" @submit.prevent="createApiKey">
            <input
              v-model="apiKeyName"
              type="text"
              class="w-full h-10 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary focus:ring-3 focus:ring-border-focus transition-all"
              placeholder="输入用途名称，例如 数据同步任务"
              :disabled="apiKeyLoading"
            />
            <button class="inline-flex items-center justify-center gap-1.5 h-10 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-[0_4px_12px_rgba(99,102,241,0.2)] transition-all hover:brightness-104 hover:-translate-y-[0.5px] hover:shadow-[0_6px_16px_rgba(99,102,241,0.3)] disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none px-4" type="submit" :disabled="apiKeyLoading || !apiKeyName.trim()">
              <KeyRoundIcon :size="14" />
              创建 Key
            </button>
          </form>

          <div v-if="createdPlainKey" class="flex items-center justify-between gap-3 p-3 border border-blue-500/20 rounded-lg bg-blue-50">
            <div class="flex flex-col gap-1 text-left">
              <span class="text-xs font-bold text-text-secondary">新 API Key 仅展示一次</span>
              <code class="max-w-[420px] overflow-auto color-primary white-space-nowrap font-mono text-xs text-primary">{{ createdPlainKey }}</code>
            </div>
            <button class="bg-transparent border border-border-main rounded-md px-2.5 py-1 text-[11px] font-bold text-text-secondary cursor-pointer hover:bg-white hover:text-primary hover:border-primary-muted" type="button" @click="copyApiKey(createdPlainKey)">复制</button>
          </div>

          <div class="flex flex-col gap-2.5">
            <article v-for="item in apiKeys" :key="item.id" class="flex items-center justify-between gap-3 p-3 border border-border-main rounded-lg bg-white">
              <div class="flex flex-col gap-1 text-left">
                <strong class="text-xs font-bold text-text-secondary">{{ item.name }}</strong>
                <span class="text-xs text-text-muted">{{ item.keyPrefix }}••••{{ item.keyLastFour }} · {{ formatDate(item.createdAt) }}</span>
              </div>
              <button
                class="h-7.5 px-3 border border-red-500/18 rounded-[7px] bg-red-500/6 text-error text-[11.5px] font-bold cursor-pointer disabled:border-border-main disabled:bg-gray-50 disabled:text-text-muted disabled:cursor-not-allowed"
                type="button"
                :disabled="apiKeyLoading || !item.isActive"
                @click="revokeApiKey(item.id)"
              >
                {{ item.isActive ? '废弃' : '已废弃' }}
              </button>
            </article>
            <p v-if="!apiKeys.length" class="text-xs text-text-muted leading-relaxed">暂无 API Key。</p>
          </div>
        </section>

        <!-- 修改密码模块 -->
        <section class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02),inset_0_1px_0_rgba(255,255,255,0.6)] flex flex-col gap-5">
          <div>
            <h4 class="text-[14.5px] font-bold text-text-main">修改账户密码</h4>
            <p class="text-xs text-text-muted mt-1">定期修改密码有利于保障您的账户及知识数据安全。</p>
          </div>

          <form class="flex flex-col gap-4" @submit.prevent="handleChangePassword">
            <div class="flex flex-col gap-1.5 text-left">
              <label for="oldPassword" class="text-xs font-bold text-text-secondary">当前旧密码</label>
              <input
                id="oldPassword"
                v-model="passwordForm.oldPassword"
                type="password"
                class="w-full h-10 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary focus:ring-3 focus:ring-border-focus transition-all"
                placeholder="请输入旧密码"
                required
              />
            </div>

            <div class="flex flex-col gap-1.5 text-left">
              <label for="newPassword" class="text-xs font-bold text-text-secondary">新密码</label>
              <input
                id="newPassword"
                v-model="passwordForm.newPassword"
                type="password"
                class="w-full h-10 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary focus:ring-3 focus:ring-border-focus transition-all"
                placeholder="请输入新密码（至少 6 位）"
                required
              />
            </div>

            <div class="flex flex-col gap-1.5 text-left">
              <label for="confirmPassword" class="text-xs font-bold text-text-secondary">确认新密码</label>
              <input
                id="confirmPassword"
                v-model="passwordForm.confirmPassword"
                type="password"
                class="w-full h-10 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary focus:ring-3 focus:ring-border-focus transition-all"
                placeholder="请再次输入新密码"
                required
              />
            </div>

            <!-- 报错提示区 -->
            <Transition name="fade-alert">
              <div v-if="errorMsg" class="bg-red-500/8 border border-red-500/15 text-error p-2 px-3 rounded-lg text-xs text-left">
                {{ errorMsg }}
              </div>
            </Transition>

            <button class="inline-flex items-center justify-center gap-1.5 h-10 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-[0_4px_12px_rgba(99,102,241,0.2)] transition-all hover:brightness-104 hover:-translate-y-[0.5px] hover:shadow-[0_6px_16px_rgba(99,102,241,0.3)] disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none mt-2 self-start px-4" type="submit" :disabled="loading">
              <KeyRoundIcon :size="14" />
              <span>{{ loading ? '正在提交...' : '确认修改密码' }}</span>
            </button>
          </form>
        </section>
      </div>
    </div>

    <!-- 弹窗 Toast -->
    <Transition name="toast-slide">
      <div v-if="toastMsg" class="fixed top-6 left-1/2 -translate-x-1/2 py-2.5 px-5 rounded-lg text-xs font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.08)] bg-slate-900/85 text-white backdrop-blur-[8px] z-[999]">
        {{ toastMsg }}
      </div>
    </Transition>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Trash2Icon, LogOutIcon, KeyRoundIcon } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { apiFetch, apiJson } from '@/api/client'
import type { ApiKeyItem } from '@/types'

const router = useRouter()
const authStore = useAuthStore()

const loading = ref(false)
const errorMsg = ref('')
const toastMsg = ref('')
const apiKeyLoading = ref(false)
const profileLoading = ref(false)
const apiKeyName = ref('')
const apiKeys = ref<ApiKeyItem[]>([])
const createdPlainKey = ref('')
const departmentInput = ref('')

const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const initial = computed(() => {
  const name = authStore.user?.username || '管'
  return name.slice(0, 1).toUpperCase()
})

const username = computed(() => authStore.user?.username || '企业管理员')
const ownerId = computed(() => authStore.user?.id || '无凭证')

onMounted(() => {
  void loadProfile()
  void loadApiKeys()
})

function showToast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => {
    toastMsg.value = ''
  }, 2500)
}

function copyId() {
  if (!ownerId.value || ownerId.value === '无凭证') return
  navigator.clipboard.writeText(ownerId.value)
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

async function createApiKey() {
  const name = apiKeyName.value.trim()
  if (!name) return
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
    apiKeyName.value = ''
    showToast('API Key 已创建')
    await loadApiKeys()
  } finally {
    apiKeyLoading.value = false
  }
}

async function revokeApiKey(id: string) {
  if (!confirm('确定废弃这个 API Key 吗？已接入的调用会立即失效。')) return
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
}

function copyApiKey(value: string) {
  navigator.clipboard.writeText(value)
  showToast('API Key 已复制到剪贴板。')
}

function resetLocalCache() {
  if (!confirm('确定清空本地缓存吗？这会清除您本地保存的 RAG 检索草稿。')) return
  localStorage.removeItem('__draft_rag_search')
  localStorage.removeItem('vuex')
  showToast('本地临时缓存已成功清除。')
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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        oldPassword: oldPwd,
        newPassword: newPwd,
      }),
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
  } catch (e) {
    errorMsg.value = '网络错误，请稍后再试'
  } finally {
    loading.value = false
  }
}

function handleLogout() {
  if (!confirm('确定退出当前登录吗？')) return
  authStore.logout()
  router.push('/login')
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '-'
}
</script>

<style scoped>
/* Transitions */
.fade-alert-enter-active,
.fade-alert-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.fade-alert-enter-from,
.fade-alert-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}

.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.toast-slide-enter-from,
.toast-slide-leave-to {
  opacity: 0;
  transform: translate(-50%, -15px);
}
</style>
