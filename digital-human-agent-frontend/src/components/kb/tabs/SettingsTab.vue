<template>
  <div class="tab-placeholder">SettingsTab for {{ kb.id }} (Task 9)</div>
</template>

<script setup lang="ts">
import type { KnowledgeBase } from '../../../types'
defineProps<{ kb: KnowledgeBase }>()
defineEmits<{
  (e: 'changed', kb: KnowledgeBase): void
  (e: 'deleted'): void
}>()
</script>

<style scoped>
.tab-placeholder { color: var(--text-muted); padding: 24px; }
</style>
