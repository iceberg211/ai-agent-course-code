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
      <p v-if="loadingContext" class="state-text">正在读取上下文...</p>
      <pre v-else-if="contextText">{{ contextText }}</pre>
      <pre v-else-if="activeCitation.content">{{ activeCitation.content }}</pre>
      <p v-else-if="contextError" class="state-text state-text--error">{{ contextError }}</p>
      <p v-else class="state-text">当前引用缺少知识库、文档或片段标识，暂时无法读取上下文。</p>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { LinkIcon, XIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import type { ChunkContext, Citation } from '@/types'

const props = defineProps<{
  citations: Citation[]
}>()

const active = ref<number | null>(null)
const loadingContext = ref(false)
const contextError = ref('')
const contextCache = ref<Record<string, ChunkContext>>({})
const kbApi = useKnowledgeBase()

const activeCitation = computed(() =>
  active.value == null ? null : props.citations[active.value] ?? null,
)
const activeContext = computed(() => {
  const citation = activeCitation.value
  if (!citation) return null
  const key = contextKey(citation)
  return key ? contextCache.value[key] ?? null : null
})
const contextText = computed(() => {
  const items = activeContext.value?.items ?? []
  if (!items.length) return ''
  return items
    .map((chunk) => `§${chunk.chunkIndex + 1}\n${chunk.content}`)
    .join('\n\n')
})

async function toggle(index: number) {
  if (active.value === index) {
    active.value = null
    contextError.value = ''
    return
  }
  active.value = index
  contextError.value = ''
  const citation = props.citations[index]
  if (!citation) return
  await loadContext(citation)
}

async function loadContext(citation: Citation) {
  const key = contextKey(citation)
  if (!key || contextCache.value[key]) return
  const knowledgeBaseId = resolveKnowledgeBaseId(citation)
  const documentId = resolveDocumentId(citation)
  const chunkId = resolveChunkId(citation)
  if (!knowledgeBaseId || !documentId || !chunkId) return

  loadingContext.value = true
  try {
    const context = await kbApi.getChunkContext(knowledgeBaseId, documentId, chunkId, 1, 1)
    if (context) {
      contextCache.value = { ...contextCache.value, [key]: context }
    } else {
      contextError.value = '引用上下文读取失败，请稍后重试。'
    }
  } finally {
    loadingContext.value = false
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

function resolveKnowledgeBaseId(citation: Citation): string {
  const raw = citation.knowledgeBaseId ?? citation.knowledge_base_id
  return typeof raw === 'string' ? raw : ''
}

function resolveDocumentId(citation: Citation): string {
  const raw = citation.documentId ?? citation.document_id
  return typeof raw === 'string' ? raw : ''
}

function resolveChunkId(citation: Citation): string {
  return typeof citation.id === 'string' ? citation.id : ''
}

function contextKey(citation: Citation): string {
  const knowledgeBaseId = resolveKnowledgeBaseId(citation)
  const documentId = resolveDocumentId(citation)
  const chunkId = resolveChunkId(citation)
  return knowledgeBaseId && documentId && chunkId
    ? `${knowledgeBaseId}:${documentId}:${chunkId}`
    : ''
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
.state-text {
  color: var(--text-secondary);
}
.state-text--error {
  color: var(--danger, #dc2626);
}
</style>
