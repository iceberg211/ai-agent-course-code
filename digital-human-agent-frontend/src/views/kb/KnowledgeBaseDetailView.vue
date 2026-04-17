<template>
  <main class="kb-view">
    <h2>知识库详情 · {{ kbId }}</h2>
    <p class="placeholder">Phase 3 Task 6 实现</p>
  </main>
</template>

<script setup lang="ts">
defineProps<{ kbId: string }>()
</script>

<style scoped>
.kb-view { padding: 24px; }
.placeholder { color: var(--text-muted); }
</style>
