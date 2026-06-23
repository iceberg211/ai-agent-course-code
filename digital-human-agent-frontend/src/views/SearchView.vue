<template>
  <main class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">智能搜索</p>
        <h1>先找资料，再发起问答</h1>
      </div>
    </header>

    <section class="search-box">
      <select v-model="kbId">
        <option value="">选择知识库</option>
        <option v-for="kb in knowledgeBases" :key="kb.id" :value="kb.id">{{ kb.name }}</option>
      </select>
      <input v-model="query" type="search" placeholder="搜索制度、流程、产品资料" @keydown.enter="runSearch" />
      <button type="button" :disabled="!canSearch" @click="runSearch">
        <SearchIcon :size="15" />
        搜索
      </button>
    </section>

    <section v-if="result" class="result-panel">
      <header class="result-head">
        <div>
          <span>找到 {{ chunks.length }} 个相关片段</span>
          <strong>{{ result.query }}</strong>
        </div>
        <button type="button" @click="askWithSearch">基于结果提问</button>
      </header>

      <ol v-if="chunks.length" class="results">
        <li v-for="(chunk, index) in chunks" :key="chunk.id">
          <span class="rank">{{ index + 1 }}</span>
          <article>
            <header>
              <strong>{{ chunk.source }}</strong>
              <small>第 {{ (chunk.chunk_index ?? chunk.chunkIndex ?? 0) + 1 }} 段 · 相似度 {{ fmt(chunk.similarity) }}</small>
            </header>
            <p>{{ chunk.content }}</p>
            <footer>
              <span v-if="chunk.rerank_score != null">重排 {{ fmt(chunk.rerank_score) }}</span>
              <span v-if="chunk.hybrid_score != null">混合 {{ fmt(chunk.hybrid_score) }}</span>
              <span v-if="chunk.retrieval_sources?.length">来源 {{ chunk.retrieval_sources.join(' / ') }}</span>
            </footer>
          </article>
        </li>
      </ol>
      <p v-else class="empty">没有找到结果，可以换个问题或降低检索阈值。</p>
    </section>

    <section v-else class="empty empty-large">
      <SearchIcon :size="24" />
      <p>选择知识库后输入关键词，结果会展示原文片段和分数。</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { SearchIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import type { KnowledgeBase, KnowledgeSearchChunk, KnowledgeSearchResult } from '@/types'

const router = useRouter()
const kbApi = useKnowledgeBase()
const knowledgeBases = ref<KnowledgeBase[]>([])
const kbId = ref('')
const query = ref('')
const result = ref<KnowledgeSearchResult | null>(null)

const canSearch = computed(() => kbId.value && query.value.trim() && !kbApi.searching.value)
const chunks = computed<KnowledgeSearchChunk[]>(() => {
  const value = result.value
  return value?.rerankedChunks ?? value?.stage2 ?? value?.hybridChunks ?? value?.stage1 ?? []
})

onMounted(async () => {
  knowledgeBases.value = await kbApi.listAll()
  kbId.value = knowledgeBases.value[0]?.id ?? ''
})

async function runSearch() {
  if (!canSearch.value) return
  result.value = await kbApi.searchInKb(kbId.value, query.value, {
    rerank: true,
    stage1TopK: 20,
    finalTopK: 8,
  })
}

function askWithSearch() {
  router.push({
    path: '/chat',
    query: {
      knowledgeBaseId: kbId.value,
      openKnowledgeDrawer: '1',
      q: query.value,
    },
  })
}

function fmt(value?: number) {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(3) : '-'
}
</script>

<style scoped>
.page {
  height: 100%;
  overflow: auto;
  padding: 28px 24px;
  background: var(--page-bg-accent);
}
.page-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
.eyebrow {
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  color: var(--primary);
}
h1 {
  margin: 2px 0 0;
  font-size: 24px;
}
.search-box,
.result-panel,
.empty-large {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.search-box {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) auto;
  gap: 10px;
  margin: 22px 0 14px;
  padding: 14px;
}
.search-box input,
.search-box select {
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.search-box button,
.result-head button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 42px;
  padding: 0 18px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-weight: 800;
}
.search-box button:disabled {
  opacity: 0.55;
}
.result-panel {
  padding: 16px;
}
.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.result-head span,
.result-head strong {
  display: block;
}
.result-head span {
  color: var(--text-muted);
  font-size: 12px;
}
.results {
  list-style: none;
  display: grid;
  gap: 10px;
}
.results li {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border-muted);
  border-radius: 8px;
}
.rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--primary-bg);
  color: var(--primary);
  font-weight: 800;
}
article header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
article small,
footer,
.empty {
  color: var(--text-muted);
  font-size: 12px;
}
article p {
  margin: 8px 0;
  color: var(--text-secondary);
  white-space: pre-wrap;
}
footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.empty-large {
  display: grid;
  place-items: center;
  gap: 10px;
  min-height: 260px;
  color: var(--text-muted);
}
.empty-large svg {
  color: var(--primary);
}
@media (max-width: 860px) {
  .search-box {
    grid-template-columns: 1fr;
  }
  .result-head,
  article header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
