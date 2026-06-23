<template>
  <main class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">文档管理</p>
        <h1>跨知识库管理文档状态</h1>
      </div>
      <RouterLink class="primary-link" to="/kb">上传文档</RouterLink>
    </header>

    <section class="toolbar" aria-label="文档筛选">
      <input v-model="query.q" type="search" placeholder="搜索文档名称" @keydown.enter="load" />
      <select v-model="query.knowledgeBaseId">
        <option value="">全部知识库</option>
        <option v-for="kb in knowledgeBases" :key="kb.id" :value="kb.id">{{ kb.name }}</option>
      </select>
      <select v-model="query.status">
        <option value="">全部状态</option>
        <option value="processing">处理中</option>
        <option value="completed">就绪</option>
        <option value="failed">失败</option>
      </select>
      <select v-model="query.graphStatus">
        <option value="">全部图谱状态</option>
        <option value="pending">待同步</option>
        <option value="indexed">已同步</option>
        <option value="failed">同步失败</option>
        <option value="skipped">未启用</option>
      </select>
      <button type="button" @click="load">筛选</button>
    </section>

    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>文档名</th>
            <th>知识库</th>
            <th>文件类型</th>
            <th>处理状态</th>
            <th>图谱状态</th>
            <th>片段</th>
            <th>上传时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="doc in result.items" :key="doc.id">
            <td class="name">{{ doc.filename }}</td>
            <td>{{ doc.knowledge?.name ?? resolveKnowledgeName(doc.knowledgeBaseId) }}</td>
            <td>{{ resolveFileType(doc) }}</td>
            <td>
              <span class="badge" :class="`status-${doc.status}`">{{ statusLabel(doc.status) }}</span>
              <small>{{ stageLabel(doc.processingStage ?? doc.processing_stage) }}</small>
            </td>
            <td>
              <span class="badge" :class="`graph-${doc.graphSyncStatus ?? doc.graph_sync_status}`">
                {{ graphStatusLabel(doc.graphSyncStatus ?? doc.graph_sync_status) }}
              </span>
            </td>
            <td>{{ doc.chunkCount ?? doc.chunk_count ?? 0 }}</td>
            <td>{{ formatDate(doc.createdAt ?? doc.created_at) }}</td>
            <td class="actions">
              <button type="button" @click="goValidate(doc)">验证</button>
              <button type="button" :disabled="retryingId === doc.id" @click="retry(doc)">重试</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!result.items.length" class="empty">暂无文档</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useKnowledgeBase, type DocumentListQuery } from '@/hooks/useKnowledgeBase'
import type { KnowledgeBase, KnowledgeDocumentDetail } from '@/types'

const router = useRouter()
const kbApi = useKnowledgeBase()
const knowledgeBases = ref<KnowledgeBase[]>([])
const retryingId = ref('')
const query = reactive<DocumentListQuery>({
  q: '',
  knowledgeBaseId: '',
  status: '',
  graphStatus: '',
  page: 1,
  pageSize: 50,
})
const result = reactive({
  items: [] as KnowledgeDocumentDetail[],
  total: 0,
  page: 1,
  pageSize: 50,
})

onMounted(async () => {
  knowledgeBases.value = await kbApi.listAll()
  await load()
})

async function load() {
  const next = await kbApi.listAllDocuments(query)
  result.items = next.items
  result.total = next.total
  result.page = next.page
  result.pageSize = next.pageSize
}

async function retry(doc: KnowledgeDocumentDetail) {
  const kbId = doc.knowledgeBaseId ?? doc.knowledge_base_id
  if (!kbId) return
  retryingId.value = doc.id
  try {
    await kbApi.retryDocument(kbId, doc.id)
    await load()
  } finally {
    retryingId.value = ''
  }
}

function goValidate(doc: KnowledgeDocumentDetail) {
  const kbId = doc.knowledgeBaseId ?? doc.knowledge_base_id
  if (!kbId) return
  router.push({ path: '/chat', query: { knowledgeBaseId: kbId, openKnowledgeDrawer: '1' } })
}

function resolveKnowledgeName(kbId?: string) {
  return knowledgeBases.value.find((kb) => kb.id === kbId)?.name ?? '未知知识库'
}

function resolveFileType(doc: KnowledgeDocumentDetail) {
  const mime = doc.mimeType ?? doc.mime_type ?? ''
  if (mime.includes('pdf') || doc.filename.endsWith('.pdf')) return 'PDF'
  if (doc.filename.endsWith('.md')) return 'Markdown'
  if (doc.filename.endsWith('.txt')) return 'TXT'
  return mime || '文件'
}

function statusLabel(status: string) {
  return ({ processing: '处理中', completed: '就绪', failed: '失败', pending: '排队中' } as Record<string, string>)[status] ?? status
}

function graphStatusLabel(status?: string) {
  return ({ pending: '待同步', indexed: '已同步', failed: '失败', skipped: '未启用' } as Record<string, string>)[status ?? ''] ?? '待同步'
}

function stageLabel(stage?: string) {
  const labels: Record<string, string> = {
    uploaded: '已上传',
    parsing: '解析中',
    chunking: '分片中',
    embedding: '向量写入中',
    keyword_indexing: '关键词索引中',
    graph_indexing: '图谱同步中',
    completed: '处理完成',
    failed: '处理失败',
  }
  return labels[stage ?? ''] ?? ''
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '-'
}
</script>

<style scoped>
.page {
  height: 100%;
  overflow: auto;
  padding: 28px 24px;
  background: var(--page-bg-accent);
}
.page-head,
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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
.primary-link,
.toolbar button,
.actions button {
  border: 1px solid var(--primary);
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-weight: 700;
  text-decoration: none;
}
.primary-link {
  padding: 8px 14px;
}
.toolbar {
  margin: 22px 0 14px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.toolbar input,
.toolbar select {
  height: 38px;
  min-width: 150px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}
.toolbar input {
  flex: 1;
  min-width: 220px;
}
.toolbar button {
  height: 38px;
  padding: 0 16px;
}
.table-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  min-width: 960px;
}
th,
td {
  padding: 13px 14px;
  border-bottom: 1px solid var(--border-muted);
  text-align: left;
  vertical-align: middle;
}
th {
  color: var(--text-muted);
  font-size: 12px;
  background: var(--surface-soft);
}
.name {
  font-weight: 700;
}
.badge {
  display: inline-flex;
  padding: 2px 7px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 800;
}
.status-completed,
.graph-indexed {
  color: var(--success);
  background: #ecfdf5;
}
.status-processing,
.status-pending,
.graph-pending {
  color: var(--warning);
  background: #fffbeb;
}
.status-failed,
.graph-failed {
  color: var(--error);
  background: #fef2f2;
}
.graph-skipped {
  color: var(--text-muted);
  background: var(--surface-soft);
}
td small {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
}
.actions {
  display: flex;
  gap: 8px;
}
.actions button {
  height: 30px;
  padding: 0 10px;
}
.actions button + button {
  background: var(--surface);
  color: var(--primary);
}
.actions button:disabled {
  opacity: 0.55;
}
.empty {
  padding: 24px;
  color: var(--text-muted);
}
@media (max-width: 980px) {
  .page-head,
  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .toolbar input,
  .toolbar select,
  .toolbar button {
    width: 100%;
  }
}
</style>
