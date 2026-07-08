<template>
  <aside class="relative flex flex-col w-[200px] h-full p-6 px-4 border-r border-slate-200/80 bg-white/65 backdrop-blur-md z-50 shrink-0 transition-all duration-300 max-lg:w-[68px] max-lg:p-6 max-lg:px-2 max-lg:items-center max-sm:fixed max-sm:bottom-3 max-sm:left-3 max-sm:right-3 max-sm:h-14 max-sm:w-[calc(100%-24px)] max-sm:flex-row max-sm:items-center max-sm:justify-around max-sm:px-4 max-sm:rounded-full max-sm:border max-sm:border-slate-200/80 max-sm:shadow-[0_12px_32px_rgba(15,23,42,0.08),0_1px_3px_rgba(15,23,42,0.02)] max-sm:bg-white/85 max-sm:backdrop-blur-20" aria-label="侧边主导航">
    <!-- 顶部 Logo & 产品名称 -->
    <div class="flex items-center gap-2.5 mb-7 max-lg:mb-6 max-lg:justify-center max-sm:hidden">
      <div class="flex items-center justify-center w-8 h-8 rounded-[10px] bg-[linear-gradient(135deg,#4f46e5_0%,#3b82f6_50%,#06b6d4_100%)] shadow-[0_4px_12px_rgba(59,130,246,0.25)] shrink-0" aria-hidden="true">
        <SparklesIcon :size="16" color="#fff" />
      </div>
      <div class="flex flex-col text-left max-lg:hidden">
        <span class="text-[13.5px] font-bold text-text-main tracking-tight whitespace-nowrap">企业 RAG 智能助手</span>
        <span class="text-[9px] font-semibold text-text-muted uppercase tracking-wider -mt-0.5 whitespace-nowrap">RAG Knowledge Agent</span>
      </div>
    </div>

    <!-- 垂直链接导航 -->
    <nav class="flex flex-col gap-1.5 flex-1 bg-transparent border-none p-0 rounded-none max-sm:flex-row max-sm:w-full max-sm:justify-around max-sm:gap-0" role="navigation">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-2.5 p-2.5 px-3 border border-transparent rounded-lg text-xs font-semibold text-text-secondary no-underline transition-all duration-200 hover:text-primary hover:bg-primary/4 max-lg:justify-center max-lg:p-2.5 max-lg:w-11 max-lg:h-11 max-sm:p-2 max-sm:px-4 max-sm:rounded-full"
        active-class="!bg-primary-bg !text-primary !border-blue-200/60"
      >
        <component :is="item.icon" :size="16" aria-hidden="true" />
        <span class="max-lg:hidden max-sm:hidden">{{ item.label }}</span>
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
/* 本组件已完全使用 Tailwind 响应式和重要原子类替代，无须任何 scoped css */
</style>
