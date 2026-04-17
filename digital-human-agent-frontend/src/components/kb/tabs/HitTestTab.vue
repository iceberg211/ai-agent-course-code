<template>
  <div class="tab-placeholder">HitTestTab for {{ kb.id }} (Task 8)</div>
</template>

<script setup lang="ts">
import type { KnowledgeBase } from '../../../types'
defineProps<{ kb: KnowledgeBase }>()
</script>

<style scoped>
.tab-placeholder { color: var(--text-muted); padding: 24px; }
</style>
