<template>
  <main class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">文档管理</p>
        <h1>跨知识库管理文档状态</h1>
      </div>
      <div class="head-actions">
        <button type="button" class="secondary-link" :disabled="!selectedIds.length" @click="batchRetry">
          批量重试
        </button>
        <button type="button" class="primary-link" @click="openUploadDrawer">上传中心</button>
      </div>
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
      <select v-model="query.processingStage">
        <option value="">全部阶段</option>
        <option value="uploaded">上传完成</option>
        <option value="parsing">解析中</option>
        <option value="chunking">分片中</option>
        <option value="embedding">向量写入中</option>
        <option value="keyword_indexing">关键词索引中</option>
        <option value="graph_indexing">图谱同步中</option>
        <option value="completed">完成</option>
        <option value="failed">失败</option>
      </select>
      <select v-model="query.graphStatus">
        <option value="">全部图谱状态</option>
        <option value="pending">待同步</option>
        <option value="indexed">已同步</option>
        <option value="failed">同步失败</option>
        <option value="skipped">未启用</option>
      </select>
      <select v-model="query.visibility">
        <option value="">全部权限</option>
        <option value="private">仅本人</option>
        <option value="department">部门</option>
        <option value="company">公司</option>
      </select>
      <input v-model="query.tags" placeholder="标签，逗号分隔" />
      <input v-model="query.department" placeholder="部门" />
      <input v-model="query.businessCategory" placeholder="业务分类" />
      <button type="button" @click="load">筛选</button>
    </section>

    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" :checked="allSelected" @change="toggleAll" /></th>
            <th>文档名</th>
            <th>知识库</th>
            <th>文件类型</th>
            <th>分类与权限</th>
            <th>处理状态</th>
            <th>图谱状态</th>
            <th>片段</th>
            <th>版本</th>
            <th>上传时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="doc in result.items" :key="doc.id">
            <td>
              <input v-model="selectedIds" type="checkbox" :value="doc.id" />
            </td>
            <td class="name">
              {{ doc.filename }}
              <small v-if="doc.archivedAt || doc.archived_at">已归档</small>
            </td>
            <td>{{ doc.knowledge?.name ?? resolveKnowledgeName(resolveKnowledgeId(doc)) }}</td>
            <td>{{ resolveFileType(doc) }}</td>
            <td>
              <span class="tag">{{ visibilityLabel(doc.visibility) }}</span>
              <span v-if="doc.department" class="tag">{{ doc.department }}</span>
              <span v-if="doc.businessCategory || doc.business_category" class="tag">
                {{ doc.businessCategory ?? doc.business_category }}
              </span>
              <span v-for="tag in doc.tags ?? []" :key="tag" class="tag tag--muted">{{ tag }}</span>
            </td>
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
            <td>
              v{{ doc.versionNo ?? doc.version_no ?? 1 }}
              <small>{{ doc.isCurrentVersion ?? doc.is_current_version ? '当前版本' : '历史版本' }}</small>
            </td>
            <td>{{ formatDate(doc.createdAt ?? doc.created_at) }}</td>
            <td class="actions">
              <button type="button" @click="goValidate(doc)">验证</button>
              <button type="button" @click="openChunks(doc)">片段</button>
              <button type="button" @click="openGovernance(doc)">治理</button>
              <button type="button" @click="openVersions(doc)">版本</button>
              <button v-if="doc.status === 'failed'" type="button" @click="openFailure(doc)">原因</button>
              <button type="button" :disabled="retryingId === doc.id" @click="retry(doc)">重试</button>
              <button type="button" class="danger" @click="remove(doc)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!result.items.length" class="empty">暂无文档</p>
    </section>

    <aside v-if="showUpload" class="drawer" aria-label="上传中心">
      <header>
        <div>
          <p class="eyebrow">上传中心</p>
          <h2>批量上传文档</h2>
        </div>
        <button type="button" @click="showUpload = false">关闭</button>
      </header>
      <div class="form-grid">
        <label>
          <span>知识库</span>
          <select v-model="uploadForm.knowledgeBaseId">
            <option value="">选择知识库</option>
            <option v-for="kb in knowledgeBases" :key="kb.id" :value="kb.id">{{ kb.name }}</option>
          </select>
        </label>
        <label>
          <span>分类</span>
          <input v-model="uploadForm.category" placeholder="例如 制度流程" />
        </label>
        <label>
          <span>标签</span>
          <input v-model="uploadTagsText" placeholder="多个标签用逗号分隔" />
        </label>
        <label>
          <span>部门</span>
          <input v-model="uploadForm.department" placeholder="例如 财务部" />
        </label>
        <label>
          <span>业务分类</span>
          <input v-model="uploadForm.businessCategory" placeholder="例如 报销制度" />
        </label>
        <label>
          <span>权限范围</span>
          <select v-model="uploadForm.visibility">
            <option value="company">公司</option>
            <option value="department">部门</option>
            <option value="private">仅本人</option>
          </select>
        </label>
        <label>
          <span>过期时间</span>
          <input v-model="uploadForm.expiresAt" type="date" />
        </label>
        <label class="file-input">
          <span>文件</span>
          <input type="file" multiple @change="handleFiles" />
        </label>
      </div>
      <button class="primary-link" type="button" :disabled="!canUpload" @click="submitUploads">
        开始上传
      </button>
      <ol v-if="uploadStates.length" class="upload-list">
        <li v-for="item in uploadStates" :key="item.name">
          <strong>{{ item.name }}</strong>
          <span>{{ item.stage }} · {{ item.progress }}%</span>
          <div class="progress"><i :style="{ width: `${item.progress}%` }" /></div>
          <em v-if="item.error">{{ item.error }}</em>
        </li>
      </ol>
    </aside>

    <aside v-if="failureDoc" class="drawer drawer--narrow" aria-label="失败原因">
      <header>
        <h2>失败原因</h2>
        <button type="button" @click="failureDoc = null">关闭</button>
      </header>
      <h3>{{ failureDoc.filename }}</h3>
      <pre>{{ failureDoc.processingError ?? failureDoc.processing_error ?? '暂无错误详情' }}</pre>
    </aside>

    <aside v-if="chunkDoc" class="drawer" aria-label="文档片段">
      <header>
        <div>
          <p class="eyebrow">片段查看</p>
          <h2>{{ chunkDoc.filename }}</h2>
        </div>
        <button type="button" @click="closeChunks">关闭</button>
      </header>
      <ol class="chunk-list">
        <li v-for="chunk in chunks" :key="chunk.id">
          <strong>Chunk {{ chunk.chunkIndex + 1 }}</strong>
          <pre>{{ chunk.content }}</pre>
        </li>
      </ol>
      <p v-if="!chunks.length" class="empty">暂无片段</p>
    </aside>

    <aside v-if="governanceDoc" class="drawer drawer--narrow" aria-label="治理信息">
      <header>
        <div>
          <p class="eyebrow">治理信息</p>
          <h2>{{ governanceDoc.filename }}</h2>
        </div>
        <button type="button" @click="governanceDoc = null">关闭</button>
      </header>
      <div class="form-grid form-grid--single">
        <label>
          <span>标签</span>
          <input v-model="governanceTagsText" placeholder="多个标签用逗号分隔" />
        </label>
        <label>
          <span>部门</span>
          <input v-model="governanceForm.department" placeholder="例如 财务部" />
        </label>
        <label>
          <span>业务分类</span>
          <input v-model="governanceForm.businessCategory" placeholder="例如 报销制度" />
        </label>
        <label>
          <span>权限范围</span>
          <select v-model="governanceForm.visibility">
            <option value="company">公司</option>
            <option value="department">部门</option>
            <option value="private">仅本人</option>
          </select>
        </label>
        <label>
          <span>过期时间</span>
          <input v-model="governanceForm.expiresAt" type="date" />
        </label>
      </div>
      <button class="primary-link" type="button" @click="saveGovernance">保存治理信息</button>
    </aside>

    <aside v-if="versionDoc" class="drawer drawer--narrow" aria-label="版本管理">
      <header>
        <div>
          <p class="eyebrow">版本管理</p>
          <h2>{{ versionDoc.filename }}</h2>
        </div>
        <button type="button" @click="closeVersions">关闭</button>
      </header>
      <label class="file-input">
        <span>上传新版本</span>
        <input type="file" @change="uploadNewVersion" />
      </label>
      <ol class="version-list">
        <li v-for="item in versions" :key="item.id">
          <div>
            <strong>v{{ item.versionNo ?? item.version_no ?? 1 }}</strong>
            <span>{{ formatDate(item.createdAt ?? item.created_at) }}</span>
          </div>
          <div class="version-actions">
            <button
              type="button"
              :disabled="Boolean(item.isCurrentVersion ?? item.is_current_version)"
              @click="makeCurrent(item)"
            >
              设为当前
            </button>
            <button type="button" @click="archive(item)">归档</button>
          </div>
        </li>
      </ol>
    </aside>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useKnowledgeBase, type DocumentListQuery } from '@/hooks/useKnowledgeBase'
import type { KnowledgeBase, KnowledgeChunk, KnowledgeDocumentDetail } from '@/types'

const router = useRouter()
const route = useRoute()
const kbApi = useKnowledgeBase()
const knowledgeBases = ref<KnowledgeBase[]>([])
const retryingId = ref('')
const selectedIds = ref<string[]>([])
const showUpload = ref(false)
const uploadFiles = ref<File[]>([])
const uploadTagsText = ref('')
const uploadStates = ref<Array<{ name: string; stage: string; progress: number; error?: string }>>([])
const failureDoc = ref<KnowledgeDocumentDetail | null>(null)
const chunkDoc = ref<KnowledgeDocumentDetail | null>(null)
const chunks = ref<KnowledgeChunk[]>([])
const governanceDoc = ref<KnowledgeDocumentDetail | null>(null)
const governanceTagsText = ref('')
const versionDoc = ref<KnowledgeDocumentDetail | null>(null)
const versions = ref<KnowledgeDocumentDetail[]>([])

const query = reactive<DocumentListQuery>({
  q: '',
  knowledgeBaseId: '',
  status: '',
  graphStatus: '',
  processingStage: '',
  tags: '',
  department: '',
  businessCategory: '',
  visibility: '',
  page: 1,
  pageSize: 50,
})
const uploadForm = reactive({
  knowledgeBaseId: '',
  category: '',
  department: '',
  businessCategory: '',
  visibility: 'company' as 'private' | 'department' | 'company',
  expiresAt: '',
})
const governanceForm = reactive({
  department: '',
  businessCategory: '',
  visibility: 'company' as 'private' | 'department' | 'company',
  expiresAt: '',
})
const result = reactive({
  items: [] as KnowledgeDocumentDetail[],
  total: 0,
  page: 1,
  pageSize: 50,
})

const allSelected = computed(
  () => result.items.length > 0 && result.items.every((doc) => selectedIds.value.includes(doc.id)),
)
const canUpload = computed(() => uploadForm.knowledgeBaseId && uploadFiles.value.length > 0)

onMounted(async () => {
  applyRouteQuery()
  knowledgeBases.value = await kbApi.listAll()
  await load()
})

function applyRouteQuery() {
  for (const key of [
    'q',
    'knowledgeBaseId',
    'status',
    'graphStatus',
    'processingStage',
    'tags',
    'department',
    'businessCategory',
    'visibility',
  ] as const) {
    const value = route.query[key]
    if (typeof value === 'string') {
      query[key] = value as never
    }
  }
}

async function load() {
  const next = await kbApi.listAllDocuments(query)
  result.items = next.items
  result.total = next.total
  result.page = next.page
  result.pageSize = next.pageSize
  selectedIds.value = selectedIds.value.filter((id) => next.items.some((doc) => doc.id === id))
}

function openUploadDrawer() {
  showUpload.value = true
  uploadStates.value = []
}

function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  uploadFiles.value = Array.from(input.files ?? [])
}

async function submitUploads() {
  if (!canUpload.value) return
  uploadStates.value = uploadFiles.value.map((file) => ({ name: file.name, stage: '等待上传', progress: 0 }))
  for (const file of uploadFiles.value) {
    const state = uploadStates.value.find((item) => item.name === file.name)
    if (state) state.stage = '上传中'
    const saved = await kbApi.uploadDocumentWithProgress(
      uploadForm.knowledgeBaseId,
      file,
      {
        category: uploadForm.category,
        tags: splitTags(uploadTagsText.value),
        department: uploadForm.department,
        businessCategory: uploadForm.businessCategory,
        visibility: uploadForm.visibility,
        expiresAt: uploadForm.expiresAt,
      },
      (percent) => {
        if (state) state.progress = percent
      },
    )
    if (state) {
      state.progress = saved ? 100 : state.progress
      state.stage = saved ? stageLabel(saved.processingStage ?? saved.processing_stage) || '上传完成' : '上传失败'
      if (!saved) state.error = '后端未返回文档记录'
    }
    if (saved && state) {
      await pollDocumentProcessing(saved, state)
    }
  }
  uploadFiles.value = []
  await load()
}

async function pollDocumentProcessing(
  doc: KnowledgeDocumentDetail,
  state: { stage: string; progress: number; error?: string },
) {
  const kbId = resolveKnowledgeId(doc)
  if (!kbId) return
  for (let i = 0; i < 12; i += 1) {
    await wait(1200)
    const latest = await kbApi.listAllDocuments({
      knowledgeBaseId: kbId,
      q: doc.filename,
      page: 1,
      pageSize: 10,
    })
    const current = latest.items.find((item) => item.id === doc.id)
    if (!current) continue
    state.stage = stageLabel(current.processingStage ?? current.processing_stage) || statusLabel(current.status)
    state.error = current.processingError ?? current.processing_error ?? undefined
    if (current.status === 'completed' || current.status === 'failed') return
  }
}

async function retry(doc: KnowledgeDocumentDetail) {
  const kbId = resolveKnowledgeId(doc)
  if (!kbId) return
  retryingId.value = doc.id
  try {
    await kbApi.retryDocument(kbId, doc.id)
    await load()
  } finally {
    retryingId.value = ''
  }
}

async function batchRetry() {
  if (!selectedIds.value.length) return
  const groups = new Map<string, string[]>()
  for (const doc of result.items.filter((item) => selectedIds.value.includes(item.id))) {
    const kbId = resolveKnowledgeId(doc)
    if (!kbId) continue
    groups.set(kbId, [...(groups.get(kbId) ?? []), doc.id])
  }
  for (const [kbId, ids] of groups.entries()) {
    await kbApi.batchRetryDocuments(kbId, ids)
  }
  await load()
}

async function remove(doc: KnowledgeDocumentDetail) {
  const kbId = resolveKnowledgeId(doc)
  if (!kbId) return
  if (!confirm(`确定删除文档「${doc.filename}」吗？`)) return
  await kbApi.deleteDocument(kbId, doc.id)
  await load()
}

async function openChunks(doc: KnowledgeDocumentDetail) {
  const kbId = resolveKnowledgeId(doc)
  if (!kbId) return
  chunkDoc.value = doc
  chunks.value = await kbApi.listChunks(kbId, doc.id)
}

function closeChunks() {
  chunkDoc.value = null
  chunks.value = []
}

function openGovernance(doc: KnowledgeDocumentDetail) {
  governanceDoc.value = doc
  governanceTagsText.value = (doc.tags ?? []).join(',')
  governanceForm.department = doc.department ?? ''
  governanceForm.businessCategory = doc.businessCategory ?? doc.business_category ?? ''
  governanceForm.visibility = doc.visibility ?? 'company'
  const expiresAt = doc.expiresAt ?? doc.expires_at ?? ''
  governanceForm.expiresAt = expiresAt ? expiresAt.slice(0, 10) : ''
}

async function saveGovernance() {
  if (!governanceDoc.value) return
  const kbId = resolveKnowledgeId(governanceDoc.value)
  if (!kbId) return
  await kbApi.updateDocumentGovernance(kbId, governanceDoc.value.id, {
    tags: splitTags(governanceTagsText.value),
    department: governanceForm.department,
    businessCategory: governanceForm.businessCategory,
    visibility: governanceForm.visibility,
    expiresAt: governanceForm.expiresAt,
  })
  governanceDoc.value = null
  await load()
}

async function openVersions(doc: KnowledgeDocumentDetail) {
  const kbId = resolveKnowledgeId(doc)
  if (!kbId) return
  versionDoc.value = doc
  versions.value = await kbApi.listDocumentVersions(kbId, doc.id)
}

function closeVersions() {
  versionDoc.value = null
  versions.value = []
}

async function uploadNewVersion(event: Event) {
  const kbId = versionDoc.value ? resolveKnowledgeId(versionDoc.value) : ''
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!kbId || !versionDoc.value || !file) return
  await kbApi.uploadDocumentVersion(kbId, versionDoc.value.id, file, {
    tags: splitTags(uploadTagsText.value),
  })
  versions.value = await kbApi.listDocumentVersions(kbId, versionDoc.value.id)
  await load()
}

async function makeCurrent(doc: KnowledgeDocumentDetail) {
  const kbId = resolveKnowledgeId(doc)
  if (!kbId) return
  await kbApi.setCurrentDocumentVersion(kbId, doc.id)
  versions.value = await kbApi.listDocumentVersions(kbId, doc.id)
  await load()
}

async function archive(doc: KnowledgeDocumentDetail) {
  const kbId = resolveKnowledgeId(doc)
  if (!kbId) return
  await kbApi.archiveDocument(kbId, doc.id)
  versions.value = await kbApi.listDocumentVersions(kbId, doc.id)
  await load()
}

function openFailure(doc: KnowledgeDocumentDetail) {
  failureDoc.value = doc
}

function goValidate(doc: KnowledgeDocumentDetail) {
  const kbId = resolveKnowledgeId(doc)
  if (!kbId) return
  router.push({ path: '/chat', query: { knowledgeBaseId: kbId, openKnowledgeDrawer: '1' } })
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedIds.value = checked ? result.items.map((doc) => doc.id) : []
}

function resolveKnowledgeId(doc: KnowledgeDocumentDetail) {
  return doc.knowledgeBaseId ?? doc.knowledge_base_id
}

function resolveKnowledgeName(kbId?: string) {
  return knowledgeBases.value.find((kb) => kb.id === kbId)?.name ?? '未知知识库'
}

function resolveFileType(doc: KnowledgeDocumentDetail) {
  const mime = doc.mimeType ?? doc.mime_type ?? ''
  if (mime.includes('pdf') || doc.filename.endsWith('.pdf')) return 'PDF'
  if (doc.filename.endsWith('.doc')) return 'Word'
  if (doc.filename.endsWith('.xlsx')) return 'Excel'
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

function visibilityLabel(value?: string) {
  return ({ private: '仅本人', department: '部门', company: '公司' } as Record<string, string>)[value ?? ''] ?? '公司'
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

function splitTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '-'
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
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
.toolbar,
.head-actions {
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
h1,
h2,
h3 {
  margin: 2px 0 0;
}
h1 {
  font-size: 24px;
}
.primary-link,
.secondary-link,
.toolbar button,
.actions button,
.drawer button {
  height: 36px;
  border: 1px solid var(--primary);
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
  text-decoration: none;
}
.secondary-link {
  background: #fff;
  color: var(--primary);
}
.toolbar {
  flex-wrap: wrap;
  margin: 22px 0 14px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.toolbar input,
.toolbar select,
.form-grid input,
.form-grid select,
.file-input input {
  height: 38px;
  min-width: 150px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}
.toolbar input[type='search'] {
  flex: 1;
  min-width: 220px;
}
.toolbar button,
.head-actions button,
.drawer button {
  padding: 0 14px;
}
.table-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  overflow: auto;
}
table {
  width: 100%;
  min-width: 1320px;
  border-collapse: collapse;
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
.badge,
.tag {
  display: inline-flex;
  margin: 2px 4px 2px 0;
  padding: 2px 7px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 800;
}
.tag {
  color: var(--primary);
  background: #eff6ff;
}
.tag--muted {
  color: var(--text-secondary);
  background: var(--surface-soft);
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
  flex-wrap: wrap;
  gap: 7px;
  min-width: 260px;
}
.actions button {
  height: 30px;
  padding: 0 9px;
  background: var(--surface);
  color: var(--primary);
}
.actions .danger {
  border-color: rgba(239, 68, 68, 0.25);
  color: var(--error);
}
button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.empty {
  padding: 24px;
  color: var(--text-muted);
}
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 120;
  width: min(720px, 92vw);
  height: 100vh;
  padding: 24px;
  border-left: 1px solid var(--border);
  background: #fff;
  box-shadow: -24px 0 48px rgba(15, 23, 42, 0.14);
  overflow: auto;
}
.drawer--narrow {
  width: min(520px, 92vw);
}
.drawer header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.drawer header button {
  background: #fff;
  color: var(--text-secondary);
  border-color: var(--border);
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}
.form-grid--single {
  grid-template-columns: 1fr;
}
.form-grid label,
.file-input {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}
.upload-list,
.chunk-list,
.version-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0;
  list-style: none;
}
.upload-list li,
.chunk-list li,
.version-list li {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
}
.upload-list span,
.upload-list em {
  display: block;
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
}
.progress {
  height: 7px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #e2e8f0;
}
.progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
  transition: width 0.2s ease;
}
pre {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  line-height: 1.6;
}
.version-list li,
.version-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.version-actions button {
  height: 30px;
  background: #fff;
  color: var(--primary);
}
@media (max-width: 980px) {
  .page-head,
  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .toolbar input,
  .toolbar select,
  .toolbar button,
  .head-actions button {
    width: 100%;
  }
  .head-actions,
  .form-grid {
    grid-template-columns: 1fr;
    flex-direction: column;
  }
}
</style>
