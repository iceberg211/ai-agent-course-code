<template>
  <div v-if="citations.length" class="citations" role="list" aria-label="引用来源">
    <span
      v-for="(c, i) in citations"
      :key="i"
      class="chip"
      role="listitem"
      :title="`来源：${resolveSource(c)} 第${resolveChunkNumber(c)}段`"
    >
      <LinkIcon :size="10" aria-hidden="true" />
      {{ resolveSource(c) }} · §{{ resolveChunkNumber(c) }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { LinkIcon } from 'lucide-vue-next'
import type { Citation } from '../../types'

defineProps<{
  citations: Citation[]
}>()

function resolveChunkNumber(citation: Citation): number {
  const raw = citation.chunk_index ?? citation.chunkIndex ?? 0
  const base = Number.isFinite(Number(raw)) ? Number(raw) : 0
  return base + 1
}

function resolveSource(citation: Citation): string {
  return citation.source ?? '未知来源'
}
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
  background: var(--primary-bg);
  border: 1px solid var(--border-muted);
  color: var(--primary);
  border-radius: 20px;
  cursor: default;
  white-space: nowrap;
}
</style>
