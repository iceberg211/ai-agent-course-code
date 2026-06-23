<template>
  <div class="app-root" :class="{ 'no-nav': route.meta.hideNav }">
    <AppNav v-if="!route.meta.hideNav" />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppNav from '@/components/knowledge-base/AppNav.vue'

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
  overflow-y: auto;
}
.app-root.no-nav > :last-child {
  width: 100%;
  height: 100%;
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
    height: auto;
    overflow-y: auto;
  }
}
</style>
