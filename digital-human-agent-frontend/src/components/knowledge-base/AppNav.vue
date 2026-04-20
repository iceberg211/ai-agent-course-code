<template>
  <nav class="app-nav" aria-label="主导航">
    <RouterLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="app-nav__item"
      active-class="app-nav__item--active"
    >
      <component :is="item.icon" :size="16" aria-hidden="true" />
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<script setup lang="ts">
import { MessageSquareIcon, LibraryIcon } from 'lucide-vue-next'

const items = [
  { to: '/chat', label: '对话', icon: MessageSquareIcon },
  { to: '/kb', label: '知识库', icon: LibraryIcon },
]
</script>

<style scoped>
.app-nav {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.app-nav__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  transition: background-color 150ms, color 150ms;
}
.app-nav__item:hover {
  background: var(--primary-bg);
  color: var(--text);
}
.app-nav__item--active {
  background: var(--primary-bg);
  color: var(--primary);
}
</style>
