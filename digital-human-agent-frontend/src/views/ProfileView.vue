<template>
  <main class="profile-page p-6 h-full overflow-y-auto bg-transparent flex flex-col gap-6 w-full text-left">
    <PageHeader
      eyebrow="安全治理"
      title="个人中心"
      description="管理个人访问凭证、部门范围、API Key 与账户安全配置。"
    />

    <div class="profile-layout w-full grid grid-cols-12 gap-6">
      <!-- 左栏：个人名片与安全清理 (占 col-4) -->
      <div class="profile-sidebar col-span-12 lg:col-span-4 flex flex-col gap-6">
        <!-- 个人名片 -->
        <section class="profile-card identity-card flex items-center gap-5 p-6 bg-white/65 backdrop-blur-md border border-white/50 rounded-xl shadow-[0_4px_20px_rgba(15,23,42,0.02),inset_0_1px_0_rgba(255,255,255,0.6)]" aria-label="个人信息">
          <div class="profile-avatar w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xl font-extrabold shadow-[0_8px_24px_rgba(37,99,235,0.15)] flex-shrink-0">
            <span>{{ initial }}</span>
          </div>
          <div class="identity-copy flex flex-col gap-1">
            <h3 class="text-base font-extrabold text-text-main">{{ username }}</h3>
            <p class="inline-block self-start px-2 py-0.5 bg-primary-bg text-primary text-[10px] font-bold rounded-[6px] my-0.5">企业知识管理员</p>
            <span class="text-xs text-text-muted">系统角色：RAG & 数字人代理管理员</span>
          </div>
        </section>

        <!-- 危险与管理区域 -->
        <section class="danger-card bg-red-500/5 backdrop-blur-md border border-red-200 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02)] flex flex-col gap-5">
          <div class="text-left">
            <h4 class="text-[14.5px] font-bold text-red-600">敏感数据与账户安全</h4>
            <p class="text-xs text-text-muted mt-1">清空本地配置或安全退出当前系统。</p>
          </div>

          <div class="flex flex-col gap-5">
            <div class="flex flex-col items-start gap-2">
              <button class="danger-button inline-flex items-center gap-1.5 px-4 py-2.5 bg-red-600 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-[0_2px_4px_rgba(220,38,38,0.1)] transition-all hover:brightness-108" type="button" @click="resetLocalCache">
                <Trash2Icon :size="14" />
                清除浏览器本地缓存
              </button>
              <p class="text-xs text-text-muted leading-relaxed">重置浏览器中临时保存的 RAG 检索草稿和数字人本地配置参数。</p>
            </div>

            <div class="flex flex-col items-start gap-2 border-t border-red-500/10 pt-5">
              <button class="warning-button inline-flex items-center gap-1.5 px-4 py-2.5 bg-amber-600 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-[0_2px_4px_rgba(217,119,6,0.1)] transition-all hover:brightness-108" type="button" @click="handleLogout">
                <LogOutIcon :size="14" />
                安全退出登录
              </button>
              <p class="text-xs text-text-muted leading-relaxed">退出并清空当前用户的访问状态，返回至系统登录页。</p>
            </div>
          </div>
        </section>
      </div>

      <!-- 右栏：凭证、部门、API Key 和 密码修改 (占 col-8) -->
      <div class="profile-main col-span-12 lg:col-span-8 flex flex-col gap-6">
        <!-- 子格：凭证与部门并排 (各自占 col-6) -->
        <div class="profile-top-grid grid grid-cols-12 gap-6 w-full">
          <section class="profile-card bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02),inset_0_1px_0_rgba(255,255,255,0.6)] col-span-12 flex flex-col gap-4">
            <div>
              <h4 class="text-[14.5px] font-bold text-text-main">我的访问能力</h4>
              <p class="text-xs text-text-muted mt-1">这些信息会影响文档列表、搜索、问答引用和按钮级操作权限。</p>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div v-for="item in accessSummary" :key="item.label" class="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <span class="block text-[10.5px] font-bold text-text-muted">{{ item.label }}</span>
                <strong class="block mt-1 text-[13px] font-bold text-text-main break-all">{{ item.value }}</strong>
                <span class="block mt-1 text-[10.5px] text-text-muted leading-relaxed">{{ item.hint }}</span>
              </div>
            </div>
          </section>

          <!-- 数据访问凭证 -->
          <section class="profile-card credential-card bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02),inset_0_1px_0_rgba(255,255,255,0.6)] col-span-12 lg:col-span-6 flex flex-col gap-5">
            <div>
              <h4 class="text-[14.5px] font-bold text-text-main">数据访问凭证</h4>
              <p class="text-xs text-text-muted mt-1">这些凭证用于在后端物理隔离您的知识与记录。</p>
            </div>

            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <span class="text-xs font-bold text-text-secondary">当前用户标识 (Owner ID)</span>
                <div class="flex items-center justify-between h-10 px-3 border border-border-main rounded-lg bg-gray-50">
                  <code class="font-mono text-xs text-text-main">{{ ownerId }}</code>
                  <button class="copy-button bg-transparent border border-border-main rounded-md px-2.5 py-1 text-[11px] font-bold text-text-secondary cursor-pointer hover:bg-white hover:text-primary hover:border-primary-muted" type="button" @click="copyId">复制</button>
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
          <section class="profile-card department-card bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02),inset_0_1px_0_rgba(255,255,255,0.6)] col-span-12 lg:col-span-6 flex flex-col gap-5">
            <div>
              <h4 class="text-[14.5px] font-bold text-text-main">部门信息</h4>
              <p class="text-xs text-text-muted mt-1">部门会用于判断“部门可见”文档的检索范围。</p>
            </div>
            <form class="profile-form flex flex-col gap-3" @submit.prevent="saveDepartment">
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
              <button class="primary-button inline-flex items-center justify-center gap-1.5 h-10 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-[0_4px_12px_rgba(99,102,241,0.2)] transition-all hover:brightness-104 hover:-translate-y-[0.5px] hover:shadow-[0_6px_16px_rgba(99,102,241,0.3)] disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none mt-2.5 self-start px-4" type="submit" :disabled="profileLoading">
                保存
              </button>
            </form>
          </section>
        </div>

        <!-- API Key 管理 -->
        <section class="profile-card api-card bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02),inset_0_1px_0_rgba(255,255,255,0.6)] flex flex-col gap-5">
          <div>
            <h4 class="text-[14.5px] font-bold text-text-main">API Key 管理</h4>
            <p class="text-xs text-text-muted mt-1">用于脚本、服务端任务或内部系统调用知识库与问答接口。</p>
          </div>

          <form class="api-key-form grid grid-cols-[1fr_auto] gap-2.5" @submit.prevent="createApiKey">
            <input
              v-model="apiKeyName"
              type="text"
              class="w-full h-10 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary focus:ring-3 focus:ring-border-focus transition-all"
              placeholder="输入用途名称，例如 数据同步任务"
              :disabled="apiKeyLoading"
            />
            <button class="primary-button inline-flex items-center justify-center gap-1.5 h-10 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-[0_4px_12px_rgba(99,102,241,0.2)] transition-all hover:brightness-104 hover:-translate-y-[0.5px] hover:shadow-[0_6px_16px_rgba(99,102,241,0.3)] disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none px-4" type="submit" :disabled="apiKeyLoading || !apiKeyName.trim()">
              <KeyRoundIcon :size="14" />
              创建 Key
            </button>
          </form>

          <div v-if="createdPlainKey" class="flex items-center justify-between gap-3 p-3 border border-blue-500/20 rounded-lg bg-blue-50">
            <div class="flex flex-col gap-1 text-left">
              <span class="text-xs font-bold text-text-secondary">新 API Key 仅展示一次</span>
              <code class="max-w-[420px] overflow-auto whitespace-nowrap font-mono text-xs text-primary">{{ createdPlainKey }}</code>
            </div>
            <button class="copy-button bg-transparent border border-border-main rounded-md px-2.5 py-1 text-[11px] font-bold text-text-secondary cursor-pointer hover:bg-white hover:text-primary hover:border-primary-muted" type="button" @click="copyApiKey(createdPlainKey)">复制</button>
          </div>

          <div class="flex flex-col gap-2.5">
            <article v-for="item in apiKeys" :key="item.id" class="flex items-center justify-between gap-3 p-3 border border-border-main rounded-lg bg-white">
              <div class="flex flex-col gap-1 text-left">
                <strong class="text-xs font-bold text-text-secondary">{{ item.name }}</strong>
                <span class="text-xs text-text-muted">{{ item.keyPrefix }}••••{{ item.keyLastFour }} · {{ formatDate(item.createdAt) }}</span>
              </div>
              <button
                class="revoke-button h-7.5 px-3 border border-red-500/18 rounded-[7px] bg-red-500/6 text-error text-[11.5px] font-bold cursor-pointer disabled:border-border-main disabled:bg-gray-50 disabled:text-text-muted disabled:cursor-not-allowed"
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
        <section class="profile-card password-card bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-6 shadow-[0_4px_20px_rgba(15,23,42,0.02),inset_0_1px_0_rgba(255,255,255,0.6)] flex flex-col gap-5">
          <div>
            <h4 class="text-[14.5px] font-bold text-text-main">修改账户密码</h4>
            <p class="text-xs text-text-muted mt-1">定期修改密码有利于保障您的账户及知识数据安全。</p>
          </div>

          <form class="profile-form flex flex-col gap-4" @submit.prevent="handleChangePassword">
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

            <button class="primary-button inline-flex items-center justify-center gap-1.5 h-10 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-[0_4px_12px_rgba(99,102,241,0.2)] transition-all hover:brightness-104 hover:-translate-y-[0.5px] hover:shadow-[0_6px_16px_rgba(99,102,241,0.3)] disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none mt-2 self-start px-4" type="submit" :disabled="loading">
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
import PageHeader from '@/components/common/PageHeader.vue'
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
const roleCodes = computed(() => {
  const user = authStore.user as typeof authStore.user & { roleCodes?: string[]; roles?: string[]; role?: string }
  const values = user?.roleCodes ?? user?.roles ?? (user?.role ? [user.role] : [])
  return values.length ? values.join('、') : '未分配'
})
const accessSummary = computed(() => [
  {
    label: '当前部门',
    value: authStore.user?.department || departmentInput.value || '未设置',
    hint: '用于部门可见资料过滤',
  },
  {
    label: '角色权限',
    value: roleCodes.value,
    hint: '影响页面、菜单和按钮权限',
  },
  {
    label: 'API Key',
    value: `${apiKeys.value.filter((item) => item.isActive).length} 个有效`,
    hint: '用于服务端和脚本调用',
  },
  {
    label: '数据范围',
    value: 'Owner / Department / Company',
    hint: '搜索和问答默认按范围过滤',
  },
])

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
.profile-page {
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
  color: var(--text);
  text-align: left;
  box-sizing: border-box;
}

.profile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.profile-title {
  margin: 0;
  color: var(--text);
  font-size: 22px;
  line-height: 1.2;
  font-weight: 850;
  letter-spacing: 0;
}

.profile-subtitle {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.profile-layout {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(280px, 0.88fr) minmax(0, 1.9fr);
  gap: 24px;
  align-items: start;
}

.profile-sidebar,
.profile-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.profile-top-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
}

.profile-card,
.danger-card {
  min-width: 0;
  border-radius: 18px;
  padding: 24px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow:
    0 14px 40px rgba(15, 23, 42, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.profile-card {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.identity-card {
  flex-direction: row;
  align-items: center;
  gap: 20px;
}

.profile-avatar {
  width: 64px;
  height: 64px;
  border-radius: 999px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 26px;
  line-height: 1;
  font-weight: 900;
  background: linear-gradient(135deg, #4f8cff 0%, #1d6dff 100%);
  box-shadow: 0 10px 26px rgba(37, 99, 235, 0.2);
}

.identity-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.identity-copy h3,
.profile-card h4,
.danger-card h4 {
  margin: 0;
  color: var(--text);
  font-weight: 850;
  letter-spacing: 0;
}

.identity-copy h3 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
  line-height: 1.25;
}

.identity-copy p {
  width: fit-content;
  margin: 2px 0;
  padding: 3px 8px;
  border-radius: 7px;
  color: var(--primary);
  background: var(--primary-bg);
  font-size: 11px;
  line-height: 1.4;
  font-weight: 800;
}

.identity-copy span,
.profile-card p,
.danger-card p {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.danger-card {
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: rgba(254, 242, 242, 0.58);
  border-color: rgba(252, 165, 165, 0.6);
}

.danger-card h4 {
  color: #dc2626;
  font-size: 15px;
}

.danger-card > div:last-child {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.danger-card > div:last-child > div {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.danger-card > div:last-child > div + div {
  padding-top: 20px;
  border-top: 1px solid rgba(239, 68, 68, 0.12);
}

.profile-card h4 {
  font-size: 15px;
  line-height: 1.35;
}

.profile-card label,
.profile-card span {
  color: var(--text-secondary);
}

.profile-card label,
.profile-card .text-xs.font-bold,
.profile-card span.text-xs {
  font-size: 12px;
  line-height: 1.4;
  font-weight: 800;
}

.profile-form,
.api-key-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.api-key-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.profile-page input {
  width: 100%;
  min-width: 0;
  min-height: 42px;
  padding: 0 13px;
  color: var(--text);
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid var(--border);
  border-radius: 12px;
  outline: none;
  font-size: 13px;
  line-height: 1.4;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.profile-page input::placeholder {
  color: #94a3b8;
}

.profile-page input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
  background: #fff;
}

.profile-page input:disabled {
  cursor: not-allowed;
  opacity: 0.68;
  background: #f8fafc;
}

.credential-card code,
.api-card code {
  min-width: 0;
  overflow: auto;
  color: var(--primary);
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
}

.credential-card .h-10,
.credential-card .text-\[12\.5px\] {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 13px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #f8fafc;
}

.primary-button,
.danger-button,
.warning-button,
.copy-button,
.revoke-button {
  min-height: 38px;
  border: 0;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 16px;
  font-size: 12px;
  line-height: 1;
  font-weight: 850;
  cursor: pointer;
  white-space: nowrap;
  transition: transform 0.18s ease, filter 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.primary-button {
  color: #fff;
  background: linear-gradient(135deg, #6366f1 0%, #3b82f6 52%, #0ea5e9 100%);
  box-shadow: 0 8px 18px rgba(59, 130, 246, 0.2);
}

.danger-button {
  color: #fff;
  background: #dc2626;
  box-shadow: 0 6px 14px rgba(220, 38, 38, 0.16);
}

.warning-button {
  color: #fff;
  background: #d97706;
  box-shadow: 0 6px 14px rgba(217, 119, 6, 0.16);
}

.copy-button {
  min-height: 30px;
  padding: 0 10px;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: none;
}

.revoke-button {
  min-height: 32px;
  padding: 0 12px;
  color: var(--error);
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.18);
  border-radius: 9px;
  box-shadow: none;
}

.primary-button:hover,
.danger-button:hover,
.warning-button:hover {
  filter: brightness(1.04);
  transform: translateY(-1px);
}

.copy-button:hover {
  color: var(--primary);
  border-color: var(--primary-muted);
  background: #fff;
}

.revoke-button:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.32);
}

.profile-page button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  transform: none;
  filter: none;
}

.api-card article {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
}

.api-card article strong {
  color: var(--text-secondary);
  font-size: 13px;
}

.api-card article span,
.api-card > div:last-child > p {
  color: var(--text-muted);
  font-size: 12px;
}

.toast-slide-enter-active,
.toast-slide-leave-active,
.fade-alert-enter-active,
.fade-alert-leave-active {
  will-change: opacity, transform;
}

.profile-page :is(.bg-red-500\/8, .bg-red-500\/10) {
  color: var(--error);
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.16);
  border-radius: 10px;
}

@media (max-width: 1120px) {
  .profile-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .profile-page {
    padding: 18px;
  }

  .profile-top-grid,
  .api-key-form {
    grid-template-columns: 1fr;
  }

  .profile-card,
  .danger-card {
    padding: 20px;
  }

  .primary-button {
    width: 100%;
  }
}

@media (max-width: 560px) {
  .profile-page {
    padding: 14px;
    gap: 18px;
  }

  .identity-card {
    align-items: flex-start;
    flex-direction: column;
  }

  .profile-avatar {
    width: 56px;
    height: 56px;
    font-size: 23px;
  }
}

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
