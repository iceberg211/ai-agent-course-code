<template>
  <div class="h-full flex bg-transparent overflow-hidden" :class="route.meta.hideNav ? 'block' : 'flex-row max-sm:flex-col'">
    <AppNav v-if="!route.meta.hideNav" />
    <div class="flex flex-col h-full bg-transparent flex-1 min-w-0" :class="route.meta.hideNav ? 'w-full h-full' : 'max-sm:h-[calc(100%-68px)]'">
      <AppHeader v-if="!route.meta.hideNav" />
      <RouterView class="flex-1 min-h-0 overflow-y-auto" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppNav from '@/components/knowledge-base/AppNav.vue'
import AppHeader from '@/components/knowledge-base/AppHeader.vue'

const route = useRoute()
</script>

<style scoped>
/* 全局根布局已通过 Tailwind 响应式与动态 class 替代，无须局部样式 */
</style>
