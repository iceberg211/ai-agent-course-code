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
      {{ resolveSource(c) }} · §{{ resolveChunkNumber(c) }}<template v-if="resolveKnowledgeBaseName(c)"> · {{ resolveKnowledgeBaseName(c) }}</template>
    </button>
    <aside v-if="activeCitation" class="detail" aria-label="引用详情">
      <header>
        <strong>{{ resolveSource(activeCitation) }}</strong>
        <button type="button" aria-label="关闭引用详情" @click="active = null">
          <XIcon :size="13" />
        </button>
      </header>
      <dl>
        <div>
          <dt>片段</dt>
          <dd>第 {{ resolveChunkNumber(activeCitation) }} 段</dd>
        </div>
        <div v-if="scoreText(activeCitation)">
          <dt>分数</dt>
          <dd>{{ scoreText(activeCitation) }}</dd>
        </div>
        <div v-if="sourceText(activeCitation)">
          <dt>检索来源</dt>
          <dd>{{ sourceText(activeCitation) }}</dd>
        </div>
      </dl>
      <pre v-if="activeCitation.content">{{ activeCitation.content }}</pre>
      <p v-else>当前引用未携带原文片段，请在智能搜索或文档详情中查看上下文。</p>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { LinkIcon, XIcon } from 'lucide-vue-next'
import type { Citation } from '@/types'

const props = defineProps<{
  citations: Citation[]
}>()

const active = ref<number | null>(null)
const activeCitation = computed(() =>
  active.value == null ? null : props.citations[active.value] ?? null,
)

function toggle(index: number) {
  active.value = active.value === index ? null : index
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

function fmt(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(3) : ''
}

function scoreText(citation: Citation): string {
  const parts = [
    citation.similarity != null ? `相似度 ${fmt(citation.similarity)}` : '',
    citation.rerank_score != null ? `重排 ${fmt(citation.rerank_score)}` : '',
    citation.hybrid_score != null ? `混合 ${fmt(citation.hybrid_score)}` : '',
    citation.keyword_score != null ? `关键词 ${fmt(citation.keyword_score)}` : '',
    citation.graph_score != null ? `图谱 ${fmt(citation.graph_score)}` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function sourceText(citation: Citation): string {
  return Array.isArray(citation.retrieval_sources)
    ? citation.retrieval_sources.join(' / ')
    : ''
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
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s var(--ease-out);
}
.chip:hover {
  background: rgba(59, 130, 246, 0.06);
  border-color: rgba(59, 130, 246, 0.25);
  color: var(--primary);
  transform: translateY(-0.5px);
}
.detail {
  width: 100%;
  margin-top: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
}
.detail header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.detail header button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
}
.detail dl {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin: 8px 0;
}
.detail div {
  display: flex;
  gap: 5px;
}
.detail dt {
  color: var(--text-muted);
}
.detail dd {
  margin: 0;
  color: var(--text-secondary);
}
.detail pre,
.detail p {
  margin: 0;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--text);
  font-size: 12px;
  line-height: 1.6;
}
</style>
