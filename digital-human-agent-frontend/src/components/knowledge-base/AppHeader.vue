<template>
  <header class="app-header" aria-label="顶部全局操作栏">
    <!-- 左侧：全局欢迎与路径提示 -->
    <div class="app-header__left">
      <span class="welcome-text">
        欢迎回来，<strong class="user-highlight">{{ username }}</strong>
      </span>
      <span class="role-badge" :class="authStore.user?.role">
        {{ authStore.user?.role === 'admin' ? '系统管理员' : '普通用户' }}
      </span>
    </div>

    <!-- 右侧：就绪状态、通知中心、用户下拉名片 -->
    <div class="app-header__right">
      <!-- 1. 系统连接状态指示器 -->
      <div
        class="status-pill"
        :class="{ 'status-pill--offline': !sessionStore.connected }"
        :title="sessionStore.connected ? 'WebSocket 服务已连接，系统处于就绪状态' : '已断开与后端的 WebSocket 连接，正在重连...'"
      >
        <span class="status-pill__dot" />
        <span class="status-pill__text">
          {{ sessionStore.connected ? '系统就绪' : '连接中断' }}
        </span>
      </div>

      <!-- 2. 消息通知钟铛（Popover 触发器） -->
      <div ref="noticeContainer" class="notice-wrapper">
        <button
          class="notice-trigger"
          type="button"
          :aria-expanded="showNotifications"
          aria-label="系统通知"
          @click="toggleNotifications"
        >
          <BellIcon :size="16" />
          <span
            v-if="notificationApi.unreadCount.value"
            class="notice-badge"
            role="status"
          >
            {{ notificationApi.unreadCount.value }}
          </span>
        </button>

        <!-- 通知中心 Popover 面板 -->
        <transition name="fade-scale">
          <div
            v-if="showNotifications"
            class="notice-popover"
            role="dialog"
            aria-label="通知列表"
          >
            <div class="notice-popover__head">
              <h3>通知中心</h3>
              <div class="notice-popover__actions">
                <button
                  type="button"
                  class="action-btn"
                  title="刷新通知"
                  :disabled="notificationApi.loading.value"
                  @click="loadNotifications"
                >
                  <RefreshCwIcon :size="12" :class="{ 'spin-anim': notificationApi.loading.value }" />
                  <span>刷新</span>
                </button>
                <button
                  type="button"
                  class="action-btn"
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
            <div class="notice-popover__body">
              <ul v-if="notifications.length" class="notice-list">
                <li
                  v-for="item in notifications"
                  :key="item.id"
                  class="notice-item"
                  :class="{ 'notice-item--unread': !resolveReadAt(item) }"
                  @click="readNotification(item.id)"
                >
                  <div class="notice-item__title">
                    <span class="dot" v-if="!resolveReadAt(item)" />
                    <strong>{{ item.title }}</strong>
                  </div>
                  <p class="notice-item__msg">
                    {{ item.message || notificationTypeLabel(item.type) }}
                  </p>
                  <time class="notice-item__time">
                    {{ formatDate(resolveCreatedAt(item)) }}
                  </time>
                </li>
              </ul>
              <div v-else class="notice-empty">
                <BellIcon :size="24" class="empty-icon" />
                <p>暂无系统通知</p>
              </div>
            </div>
          </div>
        </transition>
      </div>

      <!-- 3. 用户头像名片（Dropdown 触发器） -->
      <div ref="profileContainer" class="profile-wrapper">
        <button
          class="profile-trigger"
          type="button"
          :aria-expanded="showProfileMenu"
          aria-label="用户账户"
          @click="toggleProfileMenu"
        >
          <div class="avatar-circle">
            {{ avatarLetter }}
          </div>
          <span class="username-text">{{ username }}</span>
          <ChevronDownIcon :size="13" class="arrow-icon" :class="{ 'arrow-icon--flipped': showProfileMenu }" />
        </button>

        <!-- 账户 Dropdown 下拉菜单 -->
        <transition name="fade-scale">
          <div v-if="showProfileMenu" class="profile-dropdown" role="menu">
            <div class="profile-dropdown__header">
              <span class="detail-name">{{ username }}</span>
              <span class="detail-email">{{ authStore.user?.department || '通用部门' }}</span>
            </div>
            <div class="divider" />
            <button
              class="dropdown-item"
              role="menuitem"
              type="button"
              @click="goProfile"
            >
              <UserIcon :size="14" />
              <span>个人中心</span>
            </button>
            <button
              class="dropdown-item"
              role="menuitem"
              type="button"
              @click="goRbac"
              v-if="authStore.user?.role === 'admin'"
            >
              <SettingsIcon :size="14" />
              <span>系统管理</span>
            </button>
            <div class="divider" />
            <button
              class="dropdown-item dropdown-item--danger"
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
  await loadNotifications()
  showNotifications.value = false
  if (item) navigateByNotification(item)
}

async function markAllRead() {
  await notificationApi.markAllRead()
  await loadNotifications()
}

function resolveReadAt(item: NotificationItem) {
  return item.readAt ?? item.read_at
}

function resolveCreatedAt(item: NotificationItem) {
  return item.createdAt ?? item.created_at
}

// 映射通知的类型文案
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
    return
  }
  if (targetType === 'task' || targetId) {
    router.push({ path: '/documents', query: { taskId: targetId } })
    return
  }
  if (targetType === 'evalCase' || evalCaseId || item.type === 'eval_batch_completed') {
    router.push({ path: '/evaluation', query: knowledgeId ? { knowledgeBaseId: knowledgeId } : {} })
    return
  }
  if (item.type === 'answer_low_rated') {
    router.push('/chat')
  }
}

// 下拉菜单操作逻辑
function goProfile() {
  showProfileMenu.value = false
  router.push('/profile')
}

// 跳转系统管理
function goRbac() {
  showProfileMenu.value = false
  router.push('/rbac')
}

function handleLogout() {
  showProfileMenu.value = false
  if (!confirm('确定退出当前登录吗？')) return
  authStore.logout()
  router.push('/login')
}

// 工具函数
function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) : '-'
}
</script>

<style scoped>
.app-header {
  display: flex;
  height: 52px;
  padding: 0 24px;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(226, 232, 240, 0.6);
  flex-shrink: 0;
  z-index: 40;
}

/* 左侧信息 */
.app-header__left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.welcome-text {
  font-size: 13px;
  color: var(--text-secondary);
}

.user-highlight {
  font-weight: 700;
  color: var(--primary);
}

.role-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  border-radius: var(--radius-sm);
  background: rgba(99, 102, 241, 0.06);
  color: #4f46e5;
  border: 1px solid rgba(99, 102, 241, 0.1);
}

.role-badge.admin {
  background: rgba(245, 158, 11, 0.06);
  color: #d97706;
  border-color: rgba(245, 158, 11, 0.12);
}

/* 右侧操作区 */
.app-header__right {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* 系统连接指示器 */
.status-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background: rgba(16, 185, 129, 0.05);
  border: 1px solid rgba(16, 185, 129, 0.1);
}

.status-pill__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15);
  animation: pulse-dot 2s infinite;
}

.status-pill__text {
  font-size: 11px;
  font-weight: 700;
  color: var(--success);
}

.status-pill--offline {
  background: rgba(245, 158, 11, 0.05) !important;
  border-color: rgba(245, 158, 11, 0.12) !important;
}

.status-pill--offline .status-pill__dot {
  background: var(--warning) !important;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15) !important;
  animation: pulse-warning-dot 2s infinite !important;
}

.status-pill--offline .status-pill__text {
  color: var(--warning) !important;
}

/* 消息通知中心 */
.notice-wrapper {
  position: relative;
}

.notice-trigger {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(100, 116, 139, 0.05);
  border: 1px solid rgba(100, 116, 139, 0.06);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.notice-trigger:hover {
  background: rgba(59, 130, 246, 0.06);
  border-color: rgba(59, 130, 246, 0.1);
  color: var(--primary);
}

.notice-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 50%;
  background: var(--error);
  color: #fff;
  font-size: 9px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 通知 Popover */
.notice-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 290px;
  max-height: 360px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 100;
}

.notice-popover__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.6);
  background: rgba(248, 250, 252, 0.5);
}

.notice-popover__head h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 750;
  color: var(--text);
}

.notice-popover__actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.15s ease;
}

.action-btn:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.06);
}

.action-btn:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.notice-popover__body {
  overflow-y: auto;
  max-height: 300px;
}

.notice-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.notice-item {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.4);
  cursor: pointer;
  transition: background 0.2s ease;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  text-align: left;
}

.notice-item:hover {
  background: rgba(59, 130, 246, 0.02);
}

.notice-item--unread {
  background: rgba(59, 130, 246, 0.03);
}

.notice-item__title {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.notice-item__title .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--primary);
  flex-shrink: 0;
}

.notice-item__title strong {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notice-item__msg {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.45;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.notice-item__time {
  font-size: 9.5px;
  color: var(--text-muted);
  align-self: flex-end;
}

.notice-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: var(--text-muted);
  gap: 8px;
}

.empty-icon {
  color: rgba(100, 116, 139, 0.2);
}

.notice-empty p {
  margin: 0;
  font-size: 12px;
}

/* 用户名片下拉菜单 */
.profile-wrapper {
  position: relative;
}

.profile-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-full);
  background: rgba(100, 116, 139, 0.04);
  border: 1px solid rgba(100, 116, 139, 0.05);
  color: var(--text);
  cursor: pointer;
  transition: all 0.2s ease;
}

.profile-trigger:hover {
  background: rgba(59, 130, 246, 0.04);
  border-color: rgba(59, 130, 246, 0.08);
}

.avatar-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--tech-gradient);
  color: #fff;
  font-size: 11px;
  font-weight: 850;
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.2);
}

.username-text {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.arrow-icon {
  color: var(--text-muted);
  transition: transform 0.2s ease;
}

.arrow-icon--flipped {
  transform: rotate(180deg);
}

/* 账户 Dropdown */
.profile-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 170px;
  padding: 6px 0;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08);
  z-index: 100;
}

.profile-dropdown__header {
  display: flex;
  flex-direction: column;
  padding: 8px 14px 10px;
}

.detail-name {
  font-size: 12px;
  font-weight: 750;
  color: var(--text);
}

.detail-email {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 1px;
  word-break: break-all;
}

.divider {
  height: 1px;
  background: rgba(226, 232, 240, 0.6);
  margin: 4px 0;
}

.dropdown-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.dropdown-item:hover {
  background: rgba(59, 130, 246, 0.05);
  color: var(--primary);
}

.dropdown-item--danger {
  color: var(--error);
}

.dropdown-item--danger:hover {
  background: rgba(239, 68, 68, 0.05) !important;
  color: var(--error) !important;
}

/* 动效 */
.spin-anim {
  animation: spin-kf 1s linear infinite;
}

@keyframes spin-kf {
  to { transform: rotate(360deg); }
}

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

.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: all 0.2s var(--ease-out);
}

.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-4px);
}

/* 响应式微调 */
@media (max-width: 640px) {
  .app-header {
    padding: 0 16px;
  }
  .welcome-text,
  .role-badge,
  .username-text {
    display: none !important;
  }
  .avatar-circle {
    width: 28px;
    height: 28px;
    font-size: 12px;
  }
  .arrow-icon {
    display: none;
  }
}
</style>
