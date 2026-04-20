<template>
  <div class="app-root">
    <AppNav />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import AppNav from './components/knowledge-base/AppNav.vue'
</script>

<style>
.app-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--primary-bg);
}
.app-root > :last-child {
  flex: 1;
  min-height: 0;
}
</style>
