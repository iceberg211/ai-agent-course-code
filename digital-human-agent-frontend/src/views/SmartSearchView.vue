<template>
  <main class="p-6 h-full overflow-y-auto bg-transparent flex flex-col gap-5 w-full text-left box-border">
    <PageHeader
      eyebrow="智能使用"
      title="智能搜索"
      description="查找证据、查看多路召回、RRF 融合、Rerank 排序和权限过滤过程。"
    />

    <SearchFiltersBar
      v-model:query="query"
      v-model:selected-kb-id="selectedKbId"
      v-model:file-type="fileType"
      v-model:threshold="threshold"
      v-model:stage1-top-k="stage1TopK"
      v-model:final-top-k="finalTopK"
      v-model:rerank="rerank"
      v-model:use-graph="useGraph"
      v-model:tags="tags"
      v-model:department="department"
      v-model:business-category="businessCategory"
      v-model:visibility="visibility"
      :searching="kbApi.searching.value"
      :kbs="kbs"
      @search="runSearch"
      @kb-changed="onKbChanged"
    />

    <SearchResultWorkspace
      :searching="kbApi.searching.value"
      :searched="searched"
      :results="results"
      :active-chunk="activeChunk"
      :query="query"
      :rerank="rerank"
      :trace-summary="traceSummary"
      :trace-blocks="traceBlocks"
      @select="activeChunk = $event"
      @inspect-context="inspectContext"
      @start-chat="startChatWithChunk"
      @create-eval="createEvalFromChunk"
    />

    <SearchContextDrawer
      v-model:before-chunks="beforeChunks"
      v-model:after-chunks="afterChunks"
      :open="contextOpen"
      :doc-name="activeDocName"
      :loading="loadingContext"
      :items="contextItems"
      :active-chunk-id="activeChunk?.id"
      @close="contextOpen = false"
      @reload="loadContext"
    />
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useSearchTrace } from '@/hooks/useSearchTrace'
import PageHeader from '@/components/common/PageHeader.vue'
import SearchFiltersBar from '@/components/search/SearchFiltersBar.vue'
import SearchResultWorkspace from '@/components/search/SearchResultWorkspace.vue'
import SearchContextDrawer from '@/components/search/SearchContextDrawer.vue'
import type { KnowledgeBase, KnowledgeSearchChunk, KnowledgeSearchResult } from '@/types'

const router = useRouter()
const route = useRoute()
const kbApi = useKnowledgeBase()

const query = ref('')
const kbs = ref<KnowledgeBase[]>([])
const selectedKbId = ref('')
const fileType = ref('')
const searched = ref(false)
const threshold = ref(0.2)
const stage1TopK = ref(15)
const finalTopK = ref(5)
const rerank = ref(true)
const useGraph = ref(true)
const tags = ref('')
const department = ref('')
const businessCategory = ref('')
const visibility = ref('')

const results = ref<KnowledgeSearchChunk[]>([])
const activeChunk = ref<KnowledgeSearchChunk | null>(null)
const searchResult = ref<KnowledgeSearchResult | null>(null)

const { traceSummary, traceBlocks } = useSearchTrace(searchResult, results)

const contextOpen = ref(false)
const activeDocName = ref('')
const loadingContext = ref(false)
const beforeChunks = ref(1)
const afterChunks = ref(1)
const contextItems = ref<Array<{ id: string; chunkIndex: number; content: string }>>([])

async function loadKbs() {
  const res = await kbApi.listAll()
  kbs.value = res
  const routeKbId = typeof route.query.knowledgeBaseId === 'string' ? route.query.knowledgeBaseId : ''
  const routeQuery = typeof route.query.q === 'string' ? route.query.q : ''
  if (routeQuery) query.value = routeQuery
  if (res.length > 0) {
    selectedKbId.value = res.some((kb) => kb.id === routeKbId) ? routeKbId : ''
    onKbChanged()
    if (routeQuery) void runSearch()
  }
}

onMounted(loadKbs)

function onKbChanged() {
  searched.value = false
  results.value = []
  activeChunk.value = null
  const currentKb = kbs.value.find((k) => k.id === selectedKbId.value)
  if (currentKb) {
    threshold.value = currentKb.retrievalConfig?.threshold ?? 0.2
    stage1TopK.value = currentKb.retrievalConfig?.stage1TopK ?? 15
    finalTopK.value = currentKb.retrievalConfig?.finalTopK ?? 5
    rerank.value = currentKb.retrievalConfig?.rerank ?? true
  }
}

async function runSearch() {
  const q = query.value.trim()
  if (!q) return
  activeChunk.value = null
  results.value = []
  searched.value = false

  const res = await kbApi.searchAcrossKnowledgeBases(q, {
    knowledgeBaseIds: selectedKbId.value ? [selectedKbId.value] : [],
    fileType: fileType.value,
    threshold: threshold.value,
    rerank: rerank.value,
    stage1TopK: stage1TopK.value,
    finalTopK: finalTopK.value,
    useGraph: useGraph.value,
    tags: tags.value,
    department: department.value,
    businessCategory: businessCategory.value,
    visibility: visibility.value,
  })

  searchResult.value = res
  searched.value = true
  if (res) {
    results.value = res.rerankedChunks ?? res.stage2 ?? res.hybridChunks ?? res.stage1 ?? []
    if (results.value.length > 0) activeChunk.value = results.value[0]
  }
}

async function inspectContext(chunk: KnowledgeSearchChunk) {
  activeDocName.value = chunk.source
  contextOpen.value = true
  await loadContext()
}

async function loadContext() {
  const chunk = activeChunk.value
  if (!chunk) return
  const docId = chunk.documentId || chunk.document_id
  const kbId = chunk.knowledgeBaseId || chunk.knowledge_base_id || selectedKbId.value
  if (!docId || !kbId) return

  loadingContext.value = true
  try {
    const res = await kbApi.getChunkContext(
      kbId,
      docId,
      chunk.id,
      beforeChunks.value,
      afterChunks.value,
    )
    if (res) contextItems.value = res.items
  } finally {
    loadingContext.value = false
  }
}

watch(contextOpen, (open) => {
  if (!open) contextItems.value = []
})

function startChatWithChunk(chunk: KnowledgeSearchChunk) {
  const kbId = chunk.knowledgeBaseId || chunk.knowledge_base_id || selectedKbId.value
  localStorage.setItem(
    '__draft_rag_search',
    JSON.stringify({
      query: query.value,
      kbId,
      chunkId: chunk.id,
      content: chunk.content,
      source: chunk.source,
    }),
  )
  router.push({
    path: '/chat',
    query: { knowledgeBaseId: kbId, useSearchDraft: '1' },
  })
}

function createEvalFromChunk(chunk: KnowledgeSearchChunk) {
  router.push({
    path: '/evaluation',
    query: {
      knowledgeBaseId: chunk.knowledgeBaseId || chunk.knowledge_base_id || selectedKbId.value,
      addQuestion: query.value,
      expectedAnswer: chunk.content.slice(0, 1200),
    },
  })
}
</script>
