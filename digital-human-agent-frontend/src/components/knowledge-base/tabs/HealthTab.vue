<template>
  <section class="health">
    <div class="health-grid">
      <article class="metric">
        <span>失败文档</span>
        <strong>{{ failedDocuments.length }}</strong>
      </article>
      <article class="metric">
        <span>无片段文档</span>
        <strong>{{ emptyChunkDocuments.length }}</strong>
      </article>
      <article class="metric">
        <span>图谱失败</span>
        <strong>{{ graphFailedDocuments.length }}</strong>
      </article>
      <article class="metric">
        <span>验证通过率</span>
        <strong>{{ passRate }}</strong>
      </article>
    </div>

    <div class="health-columns">
      <article class="panel">
        <header>
          <h3>需要处理的文档</h3>
          <button type="button" @click="goDocuments">打开文档管理</button>
        </header>
        <ol v-if="riskDocuments.length" class="risk-list">
          <li v-for="doc in riskDocuments" :key="doc.id">
            <strong>{{ doc.filename }}</strong>
            <span>{{ describeDocumentRisk(doc) }}</span>
          </li>
        </ol>
        <p v-else class="empty">暂无文档风险项</p>
      </article>

      <article class="panel">
        <header>
          <h3>最近低分验证</h3>
          <button type="button" @click="runBatch" :disabled="running || !evalCases.length">
            {{ running ? '运行中' : '批量运行' }}
          </button>
        </header>
        <ol v-if="failedEvalCases.length" class="risk-list">
          <li v-for="item in failedEvalCases" :key="item.id">
            <strong>{{ item.question }}</strong>
            <span>{{ item.lastRunError ?? item.last_run_error ?? '验证未通过' }}</span>
          </li>
        </ol>
        <p v-else class="empty">暂无低分验证用例</p>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import type { KnowledgeDocumentDetail, KnowledgeEvalCase } from '@/types'

const props = defineProps<{ kbId: string }>()
const router = useRouter()
const hook = useKnowledgeBase()

const documents = ref<KnowledgeDocumentDetail[]>([])
const evalCases = ref<KnowledgeEvalCase[]>([])
const running = ref(false)

const failedDocuments = computed(() => documents.value.filter((doc) => doc.status === 'failed'))
const emptyChunkDocuments = computed(() =>
  documents.value.filter((doc) => doc.status === 'completed' && (doc.chunkCount ?? doc.chunk_count ?? 0) === 0),
)
const graphFailedDocuments = computed(() =>
  documents.value.filter((doc) => (doc.graphSyncStatus ?? doc.graph_sync_status) === 'failed'),
)
const riskDocuments = computed(() =>
  [...failedDocuments.value, ...emptyChunkDocuments.value, ...graphFailedDocuments.value].slice(0, 8),
)
const failedEvalCases = computed(() =>
  evalCases.value
    .filter((item) => (item.lastRunStatus ?? item.last_run_status) === 'failed')
    .slice(0, 8),
)
const passRate = computed(() => {
  const reviewed = evalCases.value.filter((item) => item.userReviewStatus ?? item.user_review_status)
  const total = reviewed.length || evalCases.value.length
  if (!total) return '0%'
  const passed = evalCases.value.filter((item) => {
    const status = item.userReviewStatus ?? item.user_review_status ?? item.lastRunStatus ?? item.last_run_status
    return status === 'passed'
  }).length
  return `${Math.round((passed / total) * 100)}%`
})

onMounted(load)

async function load() {
  const [docResult, cases] = await Promise.all([
    hook.listDocumentsPaged(props.kbId, { page: 1, pageSize: 200 }),
    hook.listEvalCases(props.kbId),
  ])
  documents.value = docResult.items
  evalCases.value = cases
}

async function runBatch() {
  running.value = true
  try {
    evalCases.value = await hook.runEvalBatch(props.kbId)
  } finally {
    running.value = false
  }
}

function goDocuments() {
  router.push({ path: '/documents', query: { knowledgeBaseId: props.kbId, status: 'failed' } })
}

function describeDocumentRisk(doc: KnowledgeDocumentDetail) {
  if (doc.status === 'failed') {
    return doc.processingError ?? doc.processing_error ?? '处理失败'
  }
  if ((doc.chunkCount ?? doc.chunk_count ?? 0) === 0) return '没有可检索片段'
  if ((doc.graphSyncStatus ?? doc.graph_sync_status) === 'failed') {
    return doc.graphSyncError ?? doc.graph_sync_error ?? '图谱同步失败'
  }
  return '需要检查'
}
</script>

<style scoped>
.health {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.health-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.metric,
.panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.metric {
  display: flex;
  min-height: 96px;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 16px;
}
.metric span,
.risk-list span,
.empty {
  color: var(--text-muted);
  font-size: 12px;
}
.metric strong {
  font-size: 26px;
}
.health-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.panel {
  padding: 16px;
}
.panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.panel h3 {
  margin: 0;
  font-size: 15px;
}
.panel button {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--primary);
  border-radius: 7px;
  background: #fff;
  color: var(--primary);
  font-weight: 700;
}
.risk-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.risk-list li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border-radius: 8px;
  background: var(--surface-soft);
}
@media (max-width: 900px) {
  .health-columns {
    grid-template-columns: 1fr;
  }
}
</style>
