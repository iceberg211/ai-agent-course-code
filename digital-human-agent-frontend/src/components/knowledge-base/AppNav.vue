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
  </aside>
</template>

<script setup lang="ts">
import {
  BarChart3Icon,
  FileTextIcon,
  LibraryIcon,
  MessageSquareIcon,
  SearchIcon,
  SparklesIcon,
  UserCircleIcon,
  LogOutIcon,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { APP_NAV_ITEMS } from '@/common/constants'
import { useSessionStore } from '@/stores/session'
import { useAuthStore } from '@/stores/auth'

const iconMap = {
  dashboard: BarChart3Icon,
  documents: FileTextIcon,
  search: SearchIcon,
  chat: MessageSquareIcon,
  knowledge: LibraryIcon,
  profile: UserCircleIcon,
} as const

const sessionStore = useSessionStore()
const router = useRouter()
const authStore = useAuthStore()

const items = APP_NAV_ITEMS.map((item) => ({
  ...item,
  icon: iconMap[item.icon],
}))

function handleLogout() {
  if (!confirm('确定退出当前登录吗？')) return
  authStore.logout()
  router.push('/login')
}
</script>

<style scoped>
.app-sidebar {
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

.logout-btn:hover {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.18);
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
