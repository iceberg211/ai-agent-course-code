<template>
  <div v-if="citations.length" class="citations" role="list" aria-label="引用来源">
    <button
      v-for="(c, i) in citations"
      :key="i"
      class="chip"
      type="button"
      role="listitem"
      :title="resolveTitle(c)"
      @click="toggle(i)"
    >
      <LinkIcon :size="10" aria-hidden="true" />
      <span>{{ resolveSource(c) }} · §{{ resolveChunkNumber(c) }}</span>
      <span v-if="resolveKnowledgeBaseName(c)" class="kb-tag">· {{ resolveKnowledgeBaseName(c) }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { LinkIcon } from 'lucide-vue-next'
import type { Citation } from '@/types'

const props = defineProps<{
  citations: Citation[]
}>()

const emit = defineEmits<{
  (e: 'show-citation-detail', citation: Citation): void
}>()

function toggle(index: number) {
  const citation = props.citations[index]
  if (citation) {
    emit('show-citation-detail', citation)
  }
}

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
  gap: 6px; 
  margin-top: 8px; 
  margin-bottom: 2px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 600;
  padding: 3px 8px;
  background: rgba(59, 130, 246, 0.05);
  border: 1px solid rgba(59, 130, 246, 0.15);
  color: var(--primary);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
}
.chip:hover {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  transform: translateY(-0.5px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
}
.kb-tag {
  opacity: 0.8;
  font-weight: 500;
}
</style>
