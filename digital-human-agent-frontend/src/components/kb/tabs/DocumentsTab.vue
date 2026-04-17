<template>
  <div class="tab-placeholder">DocumentsTab for {{ kbId }} (Task 7)</div>
</template>

<script setup lang="ts">
defineProps<{ kbId: string }>()
</script>

<style scoped>
.tab-placeholder { color: var(--text-muted); padding: 24px; }
</style>
