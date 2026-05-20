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
import type { Citation } from '@/types'

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
.citations { 
  display: flex; 
  flex-wrap: wrap; 
  gap: 5px; 
  margin-top: 8px; 
  margin-bottom: 2px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 9.5px;
  font-weight: 600;
  padding: 1.5px 7px;
  background: rgba(148, 163, 184, 0.06);
  border: 1px solid rgba(148, 163, 184, 0.15);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: default;
  white-space: nowrap;
  transition: all 0.2s var(--ease-out);
}
.chip:hover {
  background: rgba(59, 130, 246, 0.06);
  border-color: rgba(59, 130, 246, 0.25);
  color: var(--primary);
  transform: translateY(-0.5px);
}
</style>
