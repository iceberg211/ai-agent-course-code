<template>
  <aside class="app-nav" aria-label="侧边主导航">
    <!-- 顶部 Logo & 产品名称 -->
    <div class="app-nav__brand">
      <div class="app-nav__logo" aria-hidden="true">
        <SparklesIcon :size="16" color="#fff" />
      </div>
      <div class="app-nav__brand-text">
        <span class="app-nav__title">企业知识运营台</span>
        <span class="app-nav__subtitle">Knowledge Ops</span>
      </div>
    </div>

    <nav class="app-nav__menu" role="navigation">
      <section
        v-for="group in groupedItems"
        :key="group.key"
        class="app-nav__group"
      >
        <h2 class="app-nav__group-label">
          {{ group.label }}
        </h2>
        <RouterLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="app-nav__link"
          active-class="app-nav__link--active"
        >
          <component :is="item.icon" :size="16" aria-hidden="true" />
          <span class="app-nav__link-label">{{ item.label }}</span>
        </RouterLink>
      </section>
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
import { APP_NAV_GROUPS, APP_NAV_ITEMS } from '@/common/constants'
import { useAuthStore } from '@/stores/auth'
import { apiJson } from '@/api/client'
import { usePermissions } from '@/hooks/usePermissions'

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
const { can, loadPermissions } = usePermissions()
const allowedMenuPaths = ref<Set<string> | null>(null)

const items = computed(() => {
  return APP_NAV_ITEMS
    .filter((item) => {
      if (allowedMenuPaths.value?.size) {
        return allowedMenuPaths.value.has(item.to)
      }
      if (item.to === '/rbac') {
        return can('rbac:manage') || authStore.user?.role === 'admin'
      }
      if (item.to === '/evaluation') {
        return can('evaluation:manage') || authStore.user?.role === 'admin'
      }
      return true
    })
    .map((item) => ({
      ...item,
      icon: iconMap[item.icon as keyof typeof iconMap] || UserCircleIcon,
    }))
})

const groupedItems = computed(() => {
  return APP_NAV_GROUPS
    .map((group) => ({
      ...group,
      items: items.value.filter((item) => item.group === group.key),
    }))
    .filter((group) => group.items.length > 0)
})

onMounted(async () => {
  await Promise.all([
    loadMenus(),
    loadPermissions()
  ])
})

async function loadMenus() {
  const menus = await apiJson<Array<{ path: string }>>('/api/rbac/me/menus')
  if (menus?.length) {
    allowedMenuPaths.value = new Set(menus.map((item) => item.path))
  }
}
</script>

<style scoped>
.app-nav {
  position: relative;
  z-index: 50;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 236px;
  height: 100%;
  padding: 20px 16px;
  border-right: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(12px);
  transition: width 0.25s ease, padding 0.25s ease;
}

.app-nav__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
}

.app-nav__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 50%, #06b6d4 100%);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
  flex-shrink: 0;
}

.app-nav__brand-text {
  display: flex;
  flex-direction: column;
  text-align: left;
  min-width: 0;
}

.app-nav__title {
  color: var(--text);
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.app-nav__subtitle {
  margin-top: -2px;
  color: var(--text-muted);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}

.app-nav__menu {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 16px;
  padding: 0;
  border: none;
  background: transparent;
}

.app-nav__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.app-nav__group-label {
  margin: 0;
  padding: 0 12px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.app-nav__link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.2s ease;
}

.app-nav__link:hover {
  color: var(--primary);
  background: rgba(59, 130, 246, 0.04);
}

.app-nav__link--active {
  color: var(--primary) !important;
  background: var(--primary-bg) !important;
  border-color: rgba(191, 219, 254, 0.6) !important;
}

.app-nav__link-label {
  white-space: nowrap;
}

@media (max-width: 1024px) {
  .app-nav {
    width: 76px;
    padding: 20px 8px;
    align-items: center;
  }

  .app-nav__brand {
    margin-bottom: 24px;
    justify-content: center;
  }

  .app-nav__brand-text,
  .app-nav__group-label,
  .app-nav__link-label {
    display: none;
  }

  .app-nav__link {
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 10px;
  }
}

@media (max-width: 640px) {
  .app-nav {
    position: fixed;
    bottom: 12px;
    left: 12px;
    right: 12px;
    z-index: 50;
    width: calc(100% - 24px);
    height: 56px;
    flex-direction: row;
    align-items: center;
    justify-content: space-around;
    padding: 0 16px;
    border: 1px solid rgba(226, 232, 240, 0.8);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.02);
  }

  .app-nav__brand {
    display: none;
  }

  .app-nav__menu {
    flex-direction: row;
    width: 100%;
    justify-content: space-around;
    gap: 0;
  }

  .app-nav__group {
    display: contents;
  }

  .app-nav__link {
    width: auto;
    height: auto;
    padding: 8px 16px;
    border-radius: 999px;
  }
}
</style>
