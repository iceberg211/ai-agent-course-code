<template>
  <div class="app-root">
    <AppNav />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import AppNav from '@/components/knowledge-base/AppNav.vue'
</script>

<style>
.app-root {
  height: 100%;
  display: flex;
  flex-direction: row;
  background: transparent;
  overflow: hidden;
}
.app-root > :last-child {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
}

@media (max-width: 640px) {
  .app-root {
    flex-direction: column;
  }
  .app-root > :last-child {
    height: auto;
    overflow-y: auto;
  }
}
</style>
