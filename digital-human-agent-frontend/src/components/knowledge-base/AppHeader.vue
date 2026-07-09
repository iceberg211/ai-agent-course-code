<template>
  <header class="h-[60px] border-b border-border-main bg-white/65 backdrop-blur-md px-6 flex items-center justify-between z-30 shrink-0 text-left" aria-label="顶部全局操作栏">
    <!-- 左侧：全局欢迎与路径提示 -->
    <div class="flex items-center gap-2.5 min-w-[180px]">
      <span class="text-xs text-text-muted sm:inline hidden">
        欢迎回来，<strong class="font-bold text-text-main">{{ username }}</strong>
      </span>
      <span class="inline-block px-2 py-0.5 rounded-[6px] text-[10px] font-bold text-slate-700 bg-slate-100" :class="{ 'text-primary bg-primary-bg': authStore.user?.role === 'admin' }">
        {{ authStore.user?.role === 'admin' ? '系统管理员' : '普通用户' }}
      </span>
    </div>

    <form class="hidden lg:flex items-center flex-1 max-w-[460px] mx-6 relative" role="search" @submit.prevent="submitGlobalSearch">
      <SearchIcon :size="15" class="absolute left-3 text-text-muted" />
      <input
        v-model="globalQuery"
        class="w-full h-9 pl-9 pr-3 rounded-lg border border-border-main bg-white/80 text-xs text-text-main outline-none transition-all focus:border-primary focus:ring-3 focus:ring-border-focus"
        type="search"
        placeholder="全局搜索文档、片段、问题..."
      />
    </form>

    <!-- 右侧：就绪状态、通知中心、用户下拉名片 -->
    <div class="flex items-center gap-4">
      <!-- 1. 系统连接状态指示器 -->
      <div
        class="flex items-center gap-2 p-1.5 px-3 bg-emerald-50 text-emerald-700 border border-emerald-200/50 rounded-full text-xs font-bold shrink-0 cursor-default select-none transition-all duration-200"
        :class="{ 'bg-amber-50 text-amber-700 border-amber-200/50': !sessionStore.connected }"
        :title="sessionStore.connected ? 'WebSocket 服务已连接，系统处于就绪状态' : '已断开与后端的 WebSocket 连接，正在重连...'"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-[pulse-dot_2s_infinite]" :class="{ 'bg-amber-500 animate-[pulse-warning-dot_2s_infinite]': !sessionStore.connected }" />
        <span class="sm:inline hidden">
          {{ sessionStore.connected ? '系统就绪' : '连接中断' }}
        </span>
      </div>

      <!-- 2. 消息通知钟铛（Popover 触发器） -->
      <div ref="noticeContainer" class="relative">
        <button
          class="relative w-8 h-8 rounded-full border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:border-primary/25 hover:text-primary hover:bg-slate-50"
          type="button"
          :aria-expanded="showNotifications"
          aria-label="系统通知"
          @click="toggleNotifications"
        >
          <BellIcon :size="16" />
          <span
            v-if="notificationApi.unreadCount.value"
            class="absolute -top-1 -right-1 w-4 h-4 bg-error text-white text-[9.5px] font-black rounded-full flex items-center justify-center scale-90 border border-white"
            role="status"
          >
            {{ notificationApi.unreadCount.value }}
          </span>
        </button>

        <!-- 通知中心 Popover 面板 -->
        <transition name="fade-scale">
          <div
            v-if="showNotifications"
            class="absolute top-[calc(100%+8px)] right-0 w-[280px] border border-border-main bg-white/95 backdrop-blur-[20px] rounded-xl shadow-[0_10px_25px_rgba(15,23,42,0.08)] z-[100] flex flex-col"
            role="dialog"
            aria-label="通知列表"
          >
            <div class="flex items-center justify-between p-2.5 px-3.5 border-b border-slate-200/60 bg-slate-50/50">
              <h3 class="m-0 text-xs font-bold text-text-main">通知中心</h3>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 border-none bg-transparent text-primary text-[11px] font-bold cursor-pointer p-0.5 rounded transition-colors duration-150 hover:bg-primary/6 disabled:text-text-muted disabled:cursor-not-allowed"
                  title="刷新通知"
                  :disabled="notificationApi.loading.value"
                  @click="loadNotifications"
                >
                  <RefreshCwIcon :size="12" :class="{ 'animate-spin': notificationApi.loading.value }" />
                  <span>刷新</span>
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 border-none bg-transparent text-primary text-[11px] font-bold cursor-pointer p-0.5 rounded transition-colors duration-150 hover:bg-primary/6 disabled:text-text-muted disabled:cursor-not-allowed"
                  title="全部标为已读"
                  :disabled="!notificationApi.unreadCount.value"
                  @click="markAllRead"
                >
                  <CheckIcon :size="12" />
                  <span>已读</span>
                </button>
              </div>
            </div>

            <!-- 通知滚动列表 -->
            <div class="overflow-y-auto max-h-[300px]">
              <ul v-if="notifications.length" class="list-none m-0 p-0">
                <li
                  v-for="item in notifications"
                  :key="item.id"
                  class="p-2.5 px-3.5 border-b border-slate-200/40 cursor-pointer transition-colors duration-200 flex flex-col items-start gap-1 text-left hover:bg-primary/2"
                  :class="{ 'bg-primary/3 hover:bg-primary/5': !resolveReadAt(item) }"
                  @click="readNotification(item.id)"
                >
                  <div class="flex items-center gap-1.5 w-full">
                    <span class="w-1.25 h-1.25 rounded-full bg-primary shrink-0" v-if="!resolveReadAt(item)" />
                    <strong class="text-xs font-bold text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap">{{ item.title }}</strong>
                  </div>
                  <p class="text-[11px] text-text-muted leading-relaxed m-0 line-clamp-2">
                    {{ item.message || notificationTypeLabel(item.type) }}
                  </p>
                  <time class="text-[9.5px] text-text-muted self-end mt-1">
                    {{ formatDate(resolveCreatedAt(item)) }}
                  </time>
                </li>
              </ul>
              <div v-else class="flex flex-col items-center justify-center p-8 px-4 text-text-muted gap-2 text-xs">
                <BellIcon :size="24" class="text-slate-500/20" />
                <p>暂无系统通知</p>
              </div>
            </div>
          </div>
        </transition>
      </div>

      <!-- 3. 用户头像名片（Dropdown 触发器） -->
      <div ref="profileContainer" class="relative">
        <button
          class="flex items-center gap-2 p-1 px-2.5 rounded-full bg-slate-500/4 border border-slate-500/5 text-text-main cursor-pointer transition-all duration-200 hover:bg-primary/4 hover:border-primary/8"
          type="button"
          :aria-expanded="showProfileMenu"
          aria-label="用户账户"
          @click="toggleProfileMenu"
        >
          <div class="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white text-[11px] font-black shadow-[0_2px_6px_rgba(59,130,246,0.2)]">
            {{ avatarLetter }}
          </div>
          <span class="text-xs font-bold text-text-secondary sm:inline hidden">{{ username }}</span>
          <ChevronDownIcon :size="13" class="text-text-muted transition-transform duration-200 sm:inline hidden" :class="{ 'rotate-180': showProfileMenu }" />
        </button>

        <!-- 账户 Dropdown 下拉菜单 -->
        <transition name="fade-scale">
          <div v-if="showProfileMenu" class="absolute top-[calc(100%+8px)] right-0 w-[170px] py-1.5 border border-border-main bg-white/88 backdrop-blur-[20px] rounded-xl shadow-[0_10px_25px_rgba(15,23,42,0.08)] z-[100]" role="menu">
            <div class="flex flex-col p-2 px-3.5 pb-2.5">
              <span class="text-xs font-bold text-text-main">{{ username }}</span>
              <span class="text-[10px] text-text-muted mt-0.5 break-all">{{ authStore.user?.department || '通用部门' }}</span>
            </div>
            <div class="h-[1px] bg-slate-200/60 my-1" />
            <button
              class="flex w-full items-center gap-2.5 p-2 px-3.5 border-none bg-transparent text-text-secondary text-xs font-semibold text-left cursor-pointer transition-all duration-150 hover:bg-primary/5 hover:text-primary"
              role="menuitem"
              type="button"
              @click="goProfile"
            >
              <UserIcon :size="14" />
              <span>个人中心</span>
            </button>
            <button
              class="flex w-full items-center gap-2.5 p-2 px-3.5 border-none bg-transparent text-text-secondary text-xs font-semibold text-left cursor-pointer transition-all duration-150 hover:bg-primary/5 hover:text-primary"
              role="menuitem"
              type="button"
              @click="goRbac"
              v-if="authStore.user?.role === 'admin'"
            >
              <SettingsIcon :size="14" />
              <span>系统管理</span>
            </button>
            <div class="h-[1px] bg-slate-200/60 my-1" />
            <button
              class="flex w-full items-center gap-2.5 p-2 px-3.5 border-none bg-transparent text-xs font-semibold text-left cursor-pointer transition-all duration-150 text-error hover:bg-red-500/5 hover:text-error"
              role="menuitem"
              type="button"
              @click="handleLogout"
            >
              <LogOutIcon :size="14" />
              <span>安全退出</span>
            </button>
          </div>
        </transition>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  BellIcon,
  UserIcon,
  LogOutIcon,
  SettingsIcon,
  RefreshCwIcon,
  CheckIcon,
  ChevronDownIcon,
  SearchIcon,
} from 'lucide-vue-next'
import { useSessionStore } from '@/stores/session'
import { useAuthStore } from '@/stores/auth'
import { useNotifications } from '@/hooks/useNotifications'
import type { NotificationItem } from '@/types'

const router = useRouter()
const sessionStore = useSessionStore()
const authStore = useAuthStore()
const notificationApi = useNotifications()

// 数据定义
const notifications = ref<NotificationItem[]>([])
const showNotifications = ref(false)
const showProfileMenu = ref(false)
const globalQuery = ref('')

// 容器引用（用于点击外部自动收起）
const noticeContainer = ref<HTMLElement | null>(null)
const profileContainer = ref<HTMLElement | null>(null)

// 计算属性
const username = computed(() => authStore.user?.username || '用户')
const avatarLetter = computed(() => {
  const name = username.value
  return name.charAt(0).toUpperCase()
})

// 生命周期与通知加载
onMounted(() => {
  void loadNotifications()
  document.addEventListener('click', handleOutsideClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
})

async function loadNotifications() {
  const result = await notificationApi.list({ page: 1, pageSize: 8 })
  notifications.value = result.items
}

// 展开/收起控制
function toggleNotifications() {
  showNotifications.value = !showNotifications.value
  showProfileMenu.value = false // 互斥
  if (showNotifications.value) void loadNotifications()
}

function toggleProfileMenu() {
  showProfileMenu.value = !showProfileMenu.value
  showNotifications.value = false // 互斥
}

// 点击外部关闭弹层
function handleOutsideClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (noticeContainer.value && !noticeContainer.value.contains(target)) {
    showNotifications.value = false
  }
  if (profileContainer.value && !profileContainer.value.contains(target)) {
    showProfileMenu.value = false
  }
}

// 通知中心操作逻辑
async function readNotification(id: string) {
  const item = notifications.value.find((n) => n.id === id)
  await notificationApi.markRead(id)
  if (item && !item.readAt && !item.read_at) {
    if (item.readAt) item.readAt = new Date().toISOString()
    else item.read_at = new Date().toISOString()
    notificationApi.unreadCount.value = Math.max(0, notificationApi.unreadCount.value - 1)
  }
}

async function markAllRead() {
  await notificationApi.markAllRead()
  notifications.value.forEach((item) => {
    if (item.readAt) item.readAt = new Date().toISOString()
    else item.read_at = new Date().toISOString()
  })
  notificationApi.unreadCount.value = 0
}

function goProfile() {
  showProfileMenu.value = false
  router.push('/profile')
}

function goRbac() {
  showProfileMenu.value = false
  router.push('/rbac')
}

function submitGlobalSearch() {
  const q = globalQuery.value.trim()
  if (!q) return
  router.push({ path: '/search', query: { q } })
  globalQuery.value = ''
}

function handleLogout() {
  showProfileMenu.value = false
  if (!confirm('确定退出当前登录吗？')) return
  authStore.logout()
  router.push('/login')
}

// 工具助手
function resolveReadAt(item: NotificationItem): string | undefined {
  return item.readAt || item.read_at
}

function resolveCreatedAt(item: NotificationItem): string | undefined {
  return item.createdAt || item.created_at
}

function formatDate(val?: string) {
  if (!val) return '-'
  const d = new Date(val)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function notificationTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    document_parsed: '文档解析成功',
    document_failed: '文档解析失败',
    system_alert: '系统资源告警',
  }
  return labels[type] || '系统消息'
}
</script>

<style scoped>
@keyframes pulse-dot {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.25); }
  70% { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

@keyframes pulse-warning-dot {
  0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.25); }
  70% { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0); }
  100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
}

/* Transitions */
.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-4px);
}
</style>
