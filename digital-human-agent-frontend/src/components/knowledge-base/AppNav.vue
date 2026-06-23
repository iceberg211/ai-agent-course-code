<template>
  <header class="app-header" aria-label="主导航">
    <!-- 左侧 Logo & 产品名称 -->
    <div class="brand">
      <div class="brand__logo" aria-hidden="true">
        <SparklesIcon :size="16" color="#fff" />
      </div>
      <div class="brand__text">
        <span class="brand__title">数字人知识助手</span>
        <span class="brand__subtitle">Digital Human Agent</span>
      </div>
    </div>

    <!-- 中间胶囊导航 -->
    <nav class="nav-tabs" role="navigation">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="nav-tab"
        active-class="nav-tab--active"
      >
        <component :is="item.icon" :size="15" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <!-- 右侧状态指示器 -->
    <div class="status-indicator">
      <span class="status-indicator__dot" />
      <span class="status-indicator__text">系统就绪</span>
    </div>
  </header>
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
} from 'lucide-vue-next'
import { APP_NAV_ITEMS } from '@/common/constants'

const iconMap = {
  dashboard: BarChart3Icon,
  documents: FileTextIcon,
  search: SearchIcon,
  chat: MessageSquareIcon,
  knowledge: LibraryIcon,
  profile: UserCircleIcon,
} as const

const items = APP_NAV_ITEMS.map((item) => ({
  ...item,
  icon: iconMap[item.icon],
}))
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  z-index: 10;
  position: relative;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
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
}

.brand__text {
  display: flex;
  flex-direction: column;
}

.brand__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
}

.brand__subtitle {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: -2px;
}

.nav-tabs {
  display: flex;
  flex-wrap: wrap;
  background: var(--surface-soft);
  padding: 4px;
  border-radius: var(--radius-full);
  border: 1px solid rgba(226, 232, 240, 0.8);
}

.nav-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all 0.2s var(--ease-out);
}

.nav-tab:hover {
  color: var(--text);
}

.nav-tab--active {
  background: var(--surface);
  color: var(--primary);
  box-shadow: 
    0 4px 12px rgba(0, 0, 0, 0.03),
    0 1px 2px rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(226, 232, 240, 0.4);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-full);
  background: rgba(16, 185, 129, 0.06);
  border: 1px solid rgba(16, 185, 129, 0.12);
}

.status-indicator__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
  animation: pulse-green 2s infinite;
}

.status-indicator__text {
  font-size: 11px;
  font-weight: 700;
  color: var(--success);
}

@keyframes pulse-green {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.25); }
  70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

@media (max-width: 640px) {
  .app-header {
    padding: 10px 16px;
  }
  .brand__text, .status-indicator {
    display: none;
  }
  .nav-tab span {
    display: none;
  }
  .nav-tab {
    padding: 7px 10px;
  }
}
</style>
