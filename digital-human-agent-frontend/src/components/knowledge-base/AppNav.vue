<template>
  <aside class="app-sidebar" aria-label="侧边主导航">
    <!-- 顶部 Logo & 产品名称 -->
    <div class="brand">
      <div class="brand__logo" aria-hidden="true">
        <SparklesIcon :size="16" color="#fff" />
      </div>
      <div class="brand__text">
        <span class="brand__title">数字人知识助手</span>
        <span class="brand__subtitle">Digital Human Agent</span>
      </div>
    </div>

    <!-- 垂直链接导航 -->
    <nav class="nav-tabs" role="navigation">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="nav-tab"
        active-class="nav-tab--active"
      >
        <component :is="item.icon" :size="16" aria-hidden="true" />
        <span class="tab-label">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <!-- 底部 Footer 整合退出与状态 -->
    <div class="sidebar-footer">
      <button class="notice-btn" type="button" @click="toggleNotifications">
        <BellIcon :size="13" aria-hidden="true" />
        <span>通知中心</span>
        <strong v-if="notificationApi.unreadCount.value">{{ notificationApi.unreadCount.value }}</strong>
      </button>

      <button class="logout-btn" type="button" @click="handleLogout" title="退出登录">
        <LogOutIcon :size="13" aria-hidden="true" />
        <span>退出登录</span>
      </button>

      <div
        class="status-indicator"
        :class="{ 'status-indicator--offline': !sessionStore.connected }"
      >
        <span class="status-indicator__dot" />
        <span class="status-indicator__text">
          {{ sessionStore.connected ? '系统就绪' : '连接中断' }}
        </span>
      </div>
    </div>

    <div v-if="showNotifications" class="notice-panel" role="dialog" aria-label="通知中心">
      <header>
        <strong>通知中心</strong>
        <button type="button" @click="showNotifications = false" aria-label="关闭通知">
          <XIcon :size="14" />
        </button>
      </header>
      <div class="notice-actions">
        <button type="button" :disabled="notificationApi.loading.value" @click="loadNotifications">
          刷新
        </button>
        <button type="button" :disabled="!notificationApi.unreadCount.value" @click="markAllRead">
          全部已读
        </button>
      </div>
      <ol v-if="notifications.length" class="notice-list">
        <li
          v-for="item in notifications"
          :key="item.id"
          :class="{ 'is-unread': !resolveReadAt(item) }"
        >
          <button type="button" @click="readNotification(item.id)">
            <span>{{ item.title }}</span>
            <small>{{ item.message || notificationTypeLabel(item.type) }}</small>
            <em>{{ formatDate(resolveCreatedAt(item)) }}</em>
          </button>
        </li>
      </ol>
      <p v-else class="notice-empty">暂无通知</p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import {
  BarChart3Icon,
  BellIcon,
  FileTextIcon,
  LibraryIcon,
  MessageSquareIcon,
  SearchIcon,
  SparklesIcon,
  UserCircleIcon,
  LogOutIcon,
  XIcon,
  CheckSquareIcon,
  SettingsIcon,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { APP_NAV_ITEMS } from '@/common/constants'
import { useSessionStore } from '@/stores/session'
import { useAuthStore } from '@/stores/auth'
import { useNotifications } from '@/hooks/useNotifications'
import type { NotificationItem } from '@/types'
import { apiJson } from '@/api/client'

const iconMap = {
  dashboard: BarChart3Icon,
  documents: FileTextIcon,
  search: SearchIcon,
  chat: MessageSquareIcon,
  knowledge: LibraryIcon,
  evaluation: CheckSquareIcon,
  rbac: SettingsIcon,
  profile: UserCircleIcon,
} as const

const sessionStore = useSessionStore()
const router = useRouter()
const authStore = useAuthStore()
const notificationApi = useNotifications()
const notifications = ref<NotificationItem[]>([])
const showNotifications = ref(false)
const allowedMenuPaths = ref<Set<string> | null>(null)

const items = computed(() => {
  return APP_NAV_ITEMS
    .filter((item) => {
      if (allowedMenuPaths.value?.size) {
        return allowedMenuPaths.value.has(item.to)
      }
      if (item.to === '/rbac') {
        return authStore.user?.role === 'admin'
      }
      return true
    })
    .map((item) => ({
      ...item,
      icon: iconMap[item.icon as keyof typeof iconMap] || UserCircleIcon,
    }))
})

onMounted(() => {
  void loadMenus()
  void loadNotifications()
})

async function loadMenus() {
  const menus = await apiJson<Array<{ path: string }>>('/api/rbac/me/menus')
  if (menus?.length) {
    allowedMenuPaths.value = new Set(menus.map((item) => item.path))
  }
}

async function loadNotifications() {
  const result = await notificationApi.list({ page: 1, pageSize: 8 })
  notifications.value = result.items
}

async function toggleNotifications() {
  showNotifications.value = !showNotifications.value
  if (showNotifications.value) await loadNotifications()
}

async function readNotification(id: string) {
  const item = notifications.value.find((n) => n.id === id)
  await notificationApi.markRead(id)
  await loadNotifications()
  if (item) navigateByNotification(item)
}

async function markAllRead() {
  await notificationApi.markAllRead()
  await loadNotifications()
}

function handleLogout() {
  if (!confirm('确定退出当前登录吗？')) return
  authStore.logout()
  router.push('/login')
}

function resolveReadAt(item: NotificationItem) {
  return item.readAt ?? item.read_at
}

function resolveCreatedAt(item: NotificationItem) {
  return item.createdAt ?? item.created_at
}

function notificationTypeLabel(type: string) {
  const labels: Record<string, string> = {
    document_failed: '文档处理失败',
    eval_batch_completed: '验证任务完成',
    answer_low_rated: '低评分回答',
    api_key_created: 'API Key 已创建',
    api_key_revoked: 'API Key 已废弃',
  }
  return labels[type] ?? '系统通知'
}

function navigateByNotification(item: NotificationItem) {
  const payload = item.payload ?? {}
  const targetType = String(payload.targetType ?? '')
  const targetId = String(payload.targetId ?? '')
  const knowledgeId = String(payload.knowledgeId ?? payload.knowledgeBaseId ?? '')
  const documentId = String(payload.documentId ?? '')
  const evalCaseId = String(payload.evalCaseId ?? '')

  if (targetType === 'document' || documentId || item.type === 'document_failed') {
    router.push({
      path: '/documents',
      query: documentId ? { q: documentId } : { status: 'failed' },
    })
    showNotifications.value = false
    return
  }
  if (targetType === 'task' || targetId) {
    router.push({ path: '/documents', query: { taskId: targetId } })
    showNotifications.value = false
    return
  }
  if (targetType === 'evalCase' || evalCaseId || item.type === 'eval_batch_completed') {
    router.push({ path: '/evaluation', query: knowledgeId ? { knowledgeBaseId: knowledgeId } : {} })
    showNotifications.value = false
    return
  }
  if (item.type === 'answer_low_rated') {
    router.push('/chat')
    showNotifications.value = false
  }
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '-'
}
</script>

<style scoped>
.app-sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 200px;
  height: 100%;
  padding: 24px 16px;
  border-right: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  z-index: 50;
  flex-shrink: 0;
  transition: width 0.3s var(--ease-out), padding 0.3s var(--ease-out);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
}

.brand__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--tech-gradient);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
  flex-shrink: 0;
}

.brand__text {
  display: flex;
  flex-direction: column;
  transition: opacity 0.2s ease;
}

.brand__title {
  font-size: 13.5px;
  font-weight: 750;
  color: var(--text);
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.brand__subtitle {
  font-size: 9px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: -1px;
  white-space: nowrap;
}

.nav-tabs {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  background: transparent;
  padding: 0;
  border-radius: 0;
  border: none;
}

.nav-tab {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all 0.2s var(--ease-out);
}

.nav-tab:hover {
  color: var(--primary);
  background: rgba(59, 130, 246, 0.04);
}

.nav-tab--active {
  background: var(--primary-bg) !important;
  color: var(--primary);
  border: 1px solid rgba(191, 219, 254, 0.6);
  box-shadow: none;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: rgba(16, 185, 129, 0.06);
  border: 1px solid rgba(16, 185, 129, 0.12);
  transition: all 0.2s ease;
}

.status-indicator__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
  animation: pulse-green 2s infinite;
  flex-shrink: 0;
}

.status-indicator__text {
  font-size: 11px;
  font-weight: 700;
  color: var(--success);
  white-space: nowrap;
  transition: opacity 0.2s ease;
}

.status-indicator--offline {
  background: rgba(245, 158, 11, 0.06) !important;
  border: 1px solid rgba(245, 158, 11, 0.12) !important;
}

.status-indicator--offline .status-indicator__dot {
  background: var(--warning) !important;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15) !important;
  animation: pulse-orange 2s infinite !important;
}

.status-indicator--offline .status-indicator__text {
  color: var(--warning) !important;
}

.sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: auto;
  width: 100%;
}

.notice-btn,
.logout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.1);
  color: var(--error, #ef4444);
  font-size: 11.5px;
  font-weight: 750;
  cursor: pointer;
  transition: all 0.2s var(--ease-out);
}

.notice-btn {
  justify-content: space-between;
  background: rgba(59, 130, 246, 0.05);
  border-color: rgba(59, 130, 246, 0.14);
  color: var(--primary);
}

.notice-btn span {
  margin-right: auto;
}

.notice-btn strong {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--error);
  color: #fff;
  font-size: 10px;
}

.logout-btn:hover {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.18);
}

.notice-panel {
  position: absolute;
  left: 212px;
  bottom: 18px;
  width: 320px;
  max-height: 420px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.16);
  overflow: auto;
  z-index: 80;
}

.notice-panel header,
.notice-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.notice-panel header button,
.notice-actions button {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.notice-panel header button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
}

.notice-actions {
  margin: 12px 0;
}

.notice-actions button {
  height: 28px;
  padding: 0 10px;
}

.notice-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.notice-list li {
  border: 1px solid var(--border-muted);
  border-radius: 8px;
  background: var(--surface-soft);
}

.notice-list li.is-unread {
  border-color: rgba(59, 130, 246, 0.28);
  background: #eff6ff;
}

.notice-list button {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.notice-list small,
.notice-list em,
.notice-empty {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
}

.notice-empty {
  margin: 18px 0 4px;
  text-align: center;
}

@keyframes pulse-green {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.25); }
  70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

@keyframes pulse-orange {
  0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.25); }
  70% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
  100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
}

/* 平板端适配：收起至 68px */
@media (max-width: 1024px) and (min-width: 641px) {
  .app-sidebar {
    width: 68px;
    padding: 24px 10px;
    align-items: center;
  }
  .brand {
    margin-bottom: 24px;
    justify-content: center;
  }
  .brand__text,
  .tab-label,
  .status-indicator__text {
    display: none !important;
  }
  .nav-tab {
    justify-content: center;
    padding: 10px;
    width: 44px;
    height: 44px;
  }
  .status-indicator {
    padding: 10px;
    justify-content: center;
    border-radius: 50%;
    width: 32px;
    height: 32px;
  }
  .sidebar-footer {
    align-items: center;
    width: 100%;
  }
  .logout-btn {
    padding: 0;
    justify-content: center;
    border-radius: 50%;
    width: 32px;
    height: 32px;
  }
  .logout-btn span {
    display: none !important;
  }
}

/* 手机端适配：固定在底部的横向胶囊导航 */
@media (max-width: 640px) {
  .app-sidebar {
    position: fixed;
    bottom: 12px;
    left: 12px;
    right: 12px;
    height: 56px;
    width: calc(100% - 24px);
    flex-direction: row;
    align-items: center;
    justify-content: space-around;
    padding: 0 16px;
    border-radius: var(--radius-full);
    border: 1px solid rgba(226, 232, 240, 0.8);
    box-shadow: 
      0 12px 32px rgba(15, 23, 42, 0.08),
      0 1px 3px rgba(15, 23, 42, 0.02);
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }
  .brand,
  .status-indicator,
  .sidebar-footer,
  .tab-label {
    display: none !important;
  }
  .nav-tabs {
    flex-direction: row;
    width: 100%;
    justify-content: space-around;
    gap: 0;
  }
  .nav-tab {
    padding: 8px 16px;
    border-radius: var(--radius-full);
  }
}
</style>
