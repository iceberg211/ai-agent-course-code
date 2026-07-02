<template>
  <div class="app-root" :class="{ 'no-nav': route.meta.hideNav }">
    <AppNav v-if="!route.meta.hideNav" />
    <div class="app-main-container">
      <AppHeader v-if="!route.meta.hideNav" />
      <RouterView class="app-content-view" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppNav from '@/components/knowledge-base/AppNav.vue'
import AppHeader from '@/components/knowledge-base/AppHeader.vue'

const route = useRoute()
</script>

<style>
.app-root {
  height: 100%;
  display: flex;
  flex-direction: row;
  background: transparent;
  overflow: hidden;
}
.app-root.no-nav {
  display: block;
}
.app-root > :last-child {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}
.app-root.no-nav > :last-child {
  width: 100%;
  height: 100%;
}

/* 主内容包裹区 */
.app-main-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
}

/* 核心内容视口区 */
.app-content-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

@media (max-width: 640px) {
  .app-root {
    flex-direction: column;
  }
  .app-root.no-nav {
    display: block;
  }
  .app-root > :last-child {
    height: calc(100% - 68px); /* 减去底部手机胶囊导航的高度 */
  }
}
</style>
