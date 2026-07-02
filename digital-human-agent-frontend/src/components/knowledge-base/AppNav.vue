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
  </aside>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import {
  BarChart3Icon,
  FileTextIcon,
  LibraryIcon,
  MessageSquareIcon,
  SearchIcon,
  SparklesIcon,
  UserCircleIcon,
  SettingsIcon,
  CheckSquareIcon,
} from 'lucide-vue-next'
import { APP_NAV_ITEMS } from '@/common/constants'
import { useAuthStore } from '@/stores/auth'
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

const authStore = useAuthStore()
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
})

async function loadMenus() {
  const menus = await apiJson<Array<{ path: string }>>('/api/rbac/me/menus')
  if (menus?.length) {
    allowedMenuPaths.value = new Set(menus.map((item) => item.path))
  }
}
</script>

<style scoped>
.app-sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
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
  .tab-label {
    display: none !important;
  }
  .nav-tab {
    justify-content: center;
    padding: 10px;
    width: 44px;
    height: 44px;
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
