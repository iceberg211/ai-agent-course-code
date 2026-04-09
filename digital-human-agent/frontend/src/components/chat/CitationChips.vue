<template>
  <div v-if="citations.length" class="citations" role="list" aria-label="引用来源">
    <span
      v-for="(c, i) in citations"
      :key="i"
      class="chip"
      role="listitem"
      :title="`来源：${c.source} 第${c.chunk_index + 1}段`"
    >
      <LinkIcon :size="10" aria-hidden="true" />
      {{ c.source }} · §{{ c.chunk_index + 1 }}
    </span>
  </div>
</template>

<script setup>
import { LinkIcon } from 'lucide-vue-next'
defineProps({ citations: { type: Array, default: () => [] } })
</script>

<style scoped>
.citations { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 3px 9px;
  background: rgba(124,58,237,0.07);
  border: 1px solid var(--border-muted);
  color: var(--primary);
  border-radius: 20px;
  cursor: default;
  white-space: nowrap;
}
</style>
