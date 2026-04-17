<template>
  <div v-if="citations.length" class="citations" role="list" aria-label="引用来源">
    <span
      v-for="(c, i) in citations"
      :key="i"
      class="chip"
      role="listitem"
      :title="resolveTitle(c)"
    >
      <LinkIcon :size="10" aria-hidden="true" />
      {{ resolveSource(c) }} · §{{ resolveChunkNumber(c) }}<template v-if="resolveKnowledgeBaseName(c)"> · {{ resolveKnowledgeBaseName(c) }}</template>
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

function resolveTitle(citation: Citation): string {
  const base = `来源：${resolveSource(citation)} 第${resolveChunkNumber(citation)}段`
  const kbName = resolveKnowledgeBaseName(citation)
  return kbName ? `${base}（${kbName}）` : base
}

function resolveKnowledgeBaseName(citation: Citation): string {
  if (citation.knowledgeBaseName) return citation.knowledgeBaseName
  const raw = citation.knowledgeBaseId ?? citation.knowledge_base_id
  return typeof raw === 'string' && raw ? `KB ${raw.slice(0, 8)}` : ''
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
