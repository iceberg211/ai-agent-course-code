<template>
  <main class="document-list">
    <header class="page-head">
      <div>
        <h2>文档管理</h2>
        <p class="subtitle">统一查看和控制所有知识库中的文档解析与状态</p>
      </div>
      <button class="btn-primary" type="button" @click="openUploadModal(null)">
        <PlusIcon :size="15" />
        上传文档
      </button>
    </header>

    <!-- 联合筛选区 -->
    <section class="filters-panel" aria-label="筛选面板">
      <div class="filters-grid">
        <label class="filter-field search-box">
          <span>搜索文档</span>
          <input
            v-model="query.q"
            type="text"
            placeholder="输入文件名模糊搜索…"
            @input="onSearchInput"
          />
        </label>

        <label class="filter-field">
          <span>所属知识库</span>
          <select v-model="query.knowledgeBaseId" @change="refreshList">
            <option value="">全部知识库</option>
            <option v-for="kb in kbs" :key="kb.id" :value="kb.id">
              {{ kb.name }}
            </option>
          </select>
        </label>

        <label class="filter-field">
          <span>文件类型</span>
          <select v-model="query.fileType" @change="refreshList">
            <option value="">全部类型</option>
            <option value="pdf">PDF</option>
            <option value="md">Markdown (.md)</option>
            <option value="txt">文本 (.txt)</option>
          </select>
        </label>

        <label class="filter-field">
          <span>解析状态</span>
          <select v-model="query.status" @change="refreshList">
            <option value="">全部状态</option>
            <option value="pending">排队中</option>
            <option value="processing">处理中</option>
            <option value="completed">就绪</option>
            <option value="failed">失败</option>
          </select>
        </label>

        <label class="filter-field">
          <span>图谱同步</span>
          <select v-model="query.graphStatus" @change="refreshList">
            <option value="">全部状态</option>
            <option value="pending">排队中</option>
            <option value="indexed">已同步</option>
            <option value="failed">失败</option>
            <option value="skipped">已跳过</option>
          </select>
        </label>
      </div>

      <div class="filters-actions">
        <button class="btn-reset" type="button" @click="resetFilters">
          重置筛选
        </button>
      </div>
    </section>

    <!-- 列表展示区 -->
    <section class="list-section">
      <div v-if="kbApi.documentsLoading.value && items.length === 0" class="state-placeholder">
        <div class="spinner"></div>
        <p>正在拉取文档清单…</p>
      </div>

      <div v-else-if="items.length === 0" class="state-placeholder">
        <FileTextIcon :size="28" class="placeholder-icon" />
        <p>没有找到符合筛选条件的文档</p>
        <button class="btn-ghost" type="button" @click="openUploadModal(null)">上传第一个文档</button>
      </div>

      <div v-else class="table-container">
        <table class="doc-table">
          <thead>
            <tr>
              <th scope="col">文档名称</th>
              <th scope="col">知识库</th>
              <th scope="col">大小/类型</th>
              <th scope="col">上传时间</th>
              <th scope="col">解析状态</th>
              <th scope="col">图谱状态</th>
              <th scope="col">分段数 (Chunks)</th>
              <th scope="col" class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in items" :key="doc.id">
              <td class="cell-filename">
                <div class="filename-wrapper" :title="doc.filename">
                  <FileTextIcon :size="15" class="doc-icon" />
                  <strong>{{ doc.filename }}</strong>
                </div>
              </td>
              <td>
                <span class="kb-badge" :title="doc.knowledge?.name || '未知知识库'">
                  {{ doc.knowledge?.name || '未知知识库' }}
                </span>
              </td>
              <td>
                <span class="meta-desc">
                  {{ formatSize(doc.fileSize ?? doc.file_size) }} · {{ formatType(doc.filename) }}
                </span>
              </td>
              <td>
                <span class="meta-desc">{{ formatDateTime(doc.createdAt || doc.created_at) }}</span>
              </td>
              <td>
                <span class="status-indicator-pill" :class="statusClassOf(doc.status)">
                  {{ statusLabelOf(doc.status) }}
                  <span v-if="doc.processingStage || doc.processing_stage" class="stage-sub">
                    ({{ stageLabelOf(doc.processingStage || doc.processing_stage) }})
                  </span>
                </span>
              </td>
              <td>
                <span class="status-indicator-pill" :class="graphStatusClassOf(doc.graphSyncStatus || doc.graph_sync_status)">
                  {{ graphStatusLabelOf(doc.graphSyncStatus || doc.graph_sync_status) }}
                </span>
              </td>
              <td>
                <strong class="chunk-num">{{ doc.chunkCount ?? doc.chunk_count ?? 0 }} 段</strong>
              </td>
              <td class="text-right cell-actions">
                <button
                  class="action-btn"
                  title="查看分段 Chunks"
                  type="button"
                  @click="inspectChunks(doc)"
                >
                  <EyeIcon :size="14" />
                </button>
                
                <!-- 重试/重新上传分流 -->
                <button
                  v-if="isFailed(doc)"
                  class="action-btn"
                  :title="canRetrySync(doc) ? '重试图谱与索引同步' : '重新上传原文件'"
                  type="button"
                  :disabled="retryingId === doc.id"
                  @click="handleFailedDocAction(doc)"
                >
                  <RefreshCwIcon :size="14" :class="{ 'spin-icon': retryingId === doc.id }" />
                </button>

                <button
                  class="action-btn"
                  title="去问答验证"
                  type="button"
                  @click="goToChatValidation(doc)"
                >
                  <MessageSquareIcon :size="14" />
                </button>

                <button
                  class="action-btn action-btn--danger"
                  title="删除文档"
                  type="button"
                  @click="deleteDoc(doc)"
                >
                  <Trash2Icon :size="14" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- 分页控制器 -->
        <footer class="pagination">
          <span class="pagination__info">共 {{ total }} 条记录</span>
          <div class="pagination__controls">
            <button
              :disabled="query.page === 1"
              class="pagination-btn"
              type="button"
              @click="changePage(query.page - 1)"
            >
              上一页
            </button>
            <span class="pagination-page">第 {{ query.page }} / {{ maxPage }} 页</span>
            <button
              :disabled="query.page >= maxPage"
              class="pagination-btn"
              type="button"
              @click="changePage(query.page + 1)"
            >
              下一页
            </button>
          </div>
        </footer>
      </div>
    </section>

    <!-- 上传文档 Modal 弹窗 -->
    <Teleport to="body">
      <div v-if="uploadOpen" class="modal-backdrop" @click.self="uploadOpen = false">
        <div class="modal">
          <header class="modal-head">
            <h3>上传新文档</h3>
            <button class="modal-close" type="button" @click="uploadOpen = false">
              <XIcon :size="16" />
            </button>
          </header>

          <form class="modal-body" @submit.prevent="submitUpload">
            <div class="field">
              <label class="label">目标知识库 <span class="required">*</span></label>
              <select v-model="uploadTargetKbId" required>
                <option value="" disabled>请选择要导入的知识库</option>
                <option v-for="kb in kbs" :key="kb.id" :value="kb.id">
                  {{ kb.name }}
                </option>
              </select>
            </div>

            <div class="field">
              <label class="label">选择文件 <span class="required">*</span></label>
              <div class="file-picker">
                <input
                  ref="fileInput"
                  type="file"
                  accept=".txt,.md,.pdf"
                  required
                  @change="onFileSelected"
                />
                <div class="file-picker__dropzone" @click="triggerFileInput">
                  <UploadCloudIcon :size="24" class="picker-icon" />
                  <span v-if="selectedFile">{{ selectedFile.name }} ({{ formatSize(selectedFile.size) }})</span>
                  <span v-else>选择文档（PDF / Markdown / TXT），点击上传</span>
                </div>
              </div>
            </div>

            <p v-if="uploadError" class="field-error">{{ uploadError }}</p>

            <footer class="modal-foot">
              <button class="btn-cancel" type="button" @click="uploadOpen = false">取消</button>
              <button
                class="btn-submit"
                type="submit"
                :disabled="kbApi.uploading.value || !uploadTargetKbId || !selectedFile"
              >
                {{ kbApi.uploading.value ? '解析上传中…' : '开始导入' }}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- Chunks 详情侧边抽屉 -->
    <Teleport to="body">
      <div v-if="chunksOpen" class="drawer-backdrop" @click.self="chunksOpen = false">
        <aside class="drawer">
          <header class="drawer-head">
            <div class="drawer-title-stack">
              <h3>分段列表 (Chunks)</h3>
              <p class="drawer-subtitle" :title="activeDoc?.filename">{{ activeDoc?.filename }}</p>
            </div>
            <button class="drawer-close" type="button" @click="chunksOpen = false">
              <XIcon :size="16" />
            </button>
          </header>

          <div class="drawer-body">
            <div v-if="kbApi.chunksLoading.value" class="drawer-loading">
              <div class="spinner"></div>
              <p>加载切片中…</p>
            </div>
            <ul v-else-if="chunks.length === 0" class="drawer-empty">
              <p>该文档没有切片</p>
            </ul>
            <ul v-else class="chunk-card-list">
              <li v-for="c in chunks" :key="c.id" class="chunk-card" :class="{ 'chunk-card--disabled': !c.enabled }">
                <header class="chunk-card__head">
                  <span class="chunk-idx">§ {{ c.chunkIndex + 1 }}</span>
                  <span class="chunk-char">{{ c.charCount }} 字</span>
                  <label class="toggle-switch">
                    <input type="checkbox" :checked="c.enabled" @change="toggleChunk(c)" />
                    <span class="toggle-label">{{ c.enabled ? '启用' : '禁用' }}</span>
                  </label>
                </header>
                <pre class="chunk-card__body">{{ c.content }}</pre>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  EyeIcon,
  FileTextIcon,
  MessageSquareIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadCloudIcon,
  XIcon,
} from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import type { KnowledgeBase, KnowledgeChunk, KnowledgeDocumentDetail } from '@/types'
import { KNOWLEDGE_DOCUMENT_STATUS_LABELS } from '@/common/constants'

const router = useRouter()
const kbApi = useKnowledgeBase()
const kbStore = useKnowledgeBaseStore()

const items = ref<KnowledgeDocumentDetail[]>([])
const kbs = ref<KnowledgeBase[]>([])
const total = ref(0)
const retryingId = ref('')

// 筛选条件
const query = reactive({
  q: '',
  knowledgeBaseId: '',
  fileType: '',
  status: '',
  graphStatus: '',
  page: 1,
  pageSize: 15,
})

const maxPage = computed(() => Math.max(1, Math.ceil(total.value / query.pageSize)))

// 异步防抖搜索
let searchTimeout: ReturnType<typeof setTimeout>
function onSearchInput() {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    query.page = 1
    refreshList()
  }, 350)
}

function resetFilters() {
  query.q = ''
  query.knowledgeBaseId = ''
  query.fileType = ''
  query.status = ''
  query.graphStatus = ''
  query.page = 1
  refreshList()
}

// 载入列表与基础数据
async function refreshList() {
  const res = await kbApi.listAllDocuments(query)
  items.value = res.items
  total.value = res.total
}

async function loadKbs() {
  const result = await kbApi.listAll()
  kbs.value = result
  kbStore.setList(result)
}

onMounted(() => {
  loadKbs()
  refreshList()
})

function changePage(p: number) {
  if (p < 1 || p > maxPage.value) return
  query.page = p
  refreshList()
}

// 上传控制
const uploadOpen = ref(false)
const uploadTargetKbId = ref('')
const selectedFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const uploadError = ref('')

function openUploadModal(kbId: string | null) {
  uploadTargetKbId.value = kbId || ''
  selectedFile.value = null
  uploadError.value = ''
  uploadOpen.value = true
}

function triggerFileInput() {
  fileInput.value?.click()
}

function onFileSelected(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    selectedFile.value = file
  }
}

async function submitUpload() {
  if (!uploadTargetKbId.value || !selectedFile.value) return
  uploadError.value = ''
  
  const result = await kbApi.uploadDocument(uploadTargetKbId.value, selectedFile.value)
  if (result) {
    uploadOpen.value = false
    query.page = 1
    await refreshList()
  } else {
    uploadError.value = '文件上传并解析失败，仅支持 PDF / MD / TXT，且大小在 20MB 以内。'
  }
}

// 删除控制
async function deleteDoc(doc: KnowledgeDocumentDetail) {
  const kbId = doc.knowledgeBaseId || doc.knowledge_base_id
  if (!kbId) return
  if (!confirm(`确定彻底删除文档「${doc.filename}」吗？对应的 Chunks 及图谱关系将一并物理删除。`)) return
  
  const ok = await kbApi.deleteDocument(kbId, doc.id)
  if (ok) {
    await refreshList()
  } else {
    alert('删除失败，请稍后重试。')
  }
}

// 重试与重新上传分流
function isFailed(doc: KnowledgeDocumentDetail): boolean {
  return doc.status === 'failed' || doc.graphSyncStatus === 'failed' || doc.graph_sync_status === 'failed'
}

function canRetrySync(doc: KnowledgeDocumentDetail): boolean {
  // 如果已经切片成功 (chunkCount > 0)，说明核心内容在 PG 中存在，仅图谱同步或 ES 出错，可以走重试接口同步。
  const count = doc.chunkCount ?? doc.chunk_count ?? 0
  return count > 0
}

async function handleFailedDocAction(doc: KnowledgeDocumentDetail) {
  const kbId = doc.knowledgeBaseId || doc.knowledge_base_id
  if (!kbId) return
  
  if (canRetrySync(doc)) {
    // 重新触发同步接口
    retryingId.value = doc.id
    try {
      const res = await kbApi.retryDocument(kbId, doc.id)
      if (res) {
        await refreshList()
      } else {
        alert('重试同步失败，请稍后尝试重新上传原始文件。')
      }
    } finally {
      retryingId.value = ''
    }
  } else {
    // 根本没有分片，无法走 retry 同步，必须重新上传原始文件
    openUploadModal(kbId)
  }
}

// 问答验证跳转
function goToChatValidation(doc: KnowledgeDocumentDetail) {
  const kbId = doc.knowledgeBaseId || doc.knowledge_base_id
  router.push({
    path: '/chat',
    query: {
      knowledgeBaseId: kbId,
      openKnowledgeDrawer: '1',
    },
  })
}

// Chunks 抽屉控制
const chunksOpen = ref(false)
const activeDoc = ref<KnowledgeDocumentDetail | null>(null)
const chunks = ref<KnowledgeChunk[]>([])

async function inspectChunks(doc: KnowledgeDocumentDetail) {
  const kbId = doc.knowledgeBaseId || doc.knowledge_base_id
  if (!kbId) return
  activeDoc.value = doc
  chunksOpen.value = true
  chunks.value = []
  
  const result = await kbApi.listChunks(kbId, doc.id)
  chunks.value = result
}

async function toggleChunk(c: KnowledgeChunk) {
  const kbId = activeDoc.value?.knowledgeBaseId || activeDoc.value?.knowledge_base_id
  if (!kbId) return
  const next = !c.enabled
  const ok = await kbApi.setChunkEnabled(kbId, c.id, next)
  if (ok) {
    c.enabled = next
  }
}

// 格式化函数
function formatSize(bytes?: number | null) {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatType(filename: string) {
  const ext = filename.split('.').pop()?.toUpperCase()
  return ext || '未知'
}

function formatDateTime(val?: string) {
  if (!val) return '-'
  const d = new Date(val)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function statusLabelOf(status?: string): string {
  return KNOWLEDGE_DOCUMENT_STATUS_LABELS[status || 'pending'] ?? '未知'
}

function statusClassOf(status?: string): string {
  if (status === 'completed') return 'pill--success'
  if (status === 'failed') return 'pill--error'
  if (status === 'processing') return 'pill--warning'
  return 'pill--secondary'
}

function graphStatusLabelOf(status?: string): string {
  if (status === 'indexed') return '已同步'
  if (status === 'failed') return '同步失败'
  if (status === 'skipped') return '已跳过'
  return '排队中'
}

function graphStatusClassOf(status?: string): string {
  if (status === 'indexed') return 'pill--success'
  if (status === 'failed') return 'pill--error'
  if (status === 'skipped') return 'pill--secondary'
  return 'pill--warning'
}

const stageLabels: Record<string, string> = {
  uploaded: '已上传',
  parsing: '解析中',
  chunking: '分片中',
  embedding: '向量化中',
  keyword_indexing: '索引同步中',
  graph_indexing: '知识建图中',
  completed: '成功',
  failed: '失败',
}

function stageLabelOf(stage?: string): string {
  return (stageLabels[stage || ''] ?? stage) || '排队'
}
</script>

<style scoped>
.document-list {
  padding: 32px 24px;
  height: 100%;
  overflow-y: auto;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.page-head h2 {
  margin: 0 0 4px;
  font-size: 24px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.02em;
}

.subtitle {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--primary-gradient, linear-gradient(135deg, #3b82f6, #2563eb));
  color: #fff;
  border: none;
  border-radius: var(--radius-md, 8px);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-btn);
  transition: all 0.2s ease;
}

.btn-primary:hover {
  filter: brightness(1.04);
  transform: translateY(-1px);
  box-shadow: var(--shadow-btn-hover);
}

.filters-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 
    0 4px 20px rgba(15, 23, 42, 0.02),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.filters-grid {
  display: grid;
  grid-template-columns: 1.5fr repeat(4, 1fr);
  gap: 14px;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.filter-field span {
  font-weight: 700;
  color: var(--text-secondary);
}

.filter-field input,
.filter-field select {
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  background: #fff;
  color: var(--text);
  outline: none;
  width: 100%;
}

.filter-field input:focus,
.filter-field select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.filters-actions {
  display: flex;
  justify-content: flex-end;
}

.btn-reset {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.btn-reset:hover {
  background: var(--page-bg-accent);
  color: var(--text);
}

.list-section {
  flex: 1;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 
    0 4px 20px rgba(15, 23, 42, 0.02),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  overflow: hidden;
}

.state-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 32px;
  text-align: center;
  min-height: 280px;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(59, 130, 246, 0.1);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 12px;
}

.placeholder-icon {
  color: var(--text-muted);
  margin-bottom: 12px;
}

.state-placeholder p {
  font-size: 13.5px;
  color: var(--text-muted);
  margin: 0 0 16px;
}

.btn-ghost {
  padding: 8px 16px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--primary);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.btn-ghost:hover {
  background: var(--primary-bg);
}

.table-container {
  overflow-x: auto;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.doc-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
}

.doc-table th,
.doc-table td {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-muted, #f1f5f9);
}

.doc-table th {
  background: #f8fafc;
  color: var(--text-muted);
  font-weight: 700;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cell-filename {
  max-width: 240px;
}

.filename-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.doc-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.filename-wrapper strong {
  color: var(--text);
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-badge {
  display: inline-block;
  padding: 2px 8px;
  background: #f1f5f9;
  border-radius: 6px;
  font-size: 11.5px;
  color: var(--text-secondary);
  font-weight: 600;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-desc {
  color: var(--text-muted);
  font-size: 12px;
}

.chunk-num {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.status-indicator-pill {
  display: inline-flex;
  flex-direction: column;
  gap: 1px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.1;
}

.stage-sub {
  font-size: 9px;
  font-weight: 500;
  opacity: 0.8;
}

.pill--success { background: #ecfdf5; color: #059669; }
.pill--warning { background: #fffbeb; color: #d97706; }
.pill--error { background: #fef2f2; color: #dc2626; }
.pill--secondary { background: #f1f5f9; color: #64748b; }

.text-right { text-align: right; }

.cell-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.action-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--primary-muted);
  background: var(--primary-bg);
  color: var(--primary);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn--danger:hover {
  border-color: #fca5a5 !important;
  background: #fef2f2 !important;
  color: #dc2626 !important;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: #fff;
}

.pagination__info {
  font-size: 12px;
  color: var(--text-muted);
}

.pagination__controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pagination-btn {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.pagination-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pagination-page {
  font-size: 12px;
  color: var(--text-secondary);
}

/* Modal 样式 */
.modal-backdrop,
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.modal {
  width: 100%;
  max-width: 440px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: var(--shadow-xl);
  overflow: hidden;
}

.modal-head {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.modal-close,
.drawer-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.modal-close:hover,
.drawer-close:hover {
  background: var(--page-bg-accent);
  color: var(--text);
}

.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.required { color: #dc2626; }

.field select {
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  outline: none;
}

.file-picker input {
  display: none;
}

.file-picker__dropzone {
  border: 2px dashed var(--border);
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  background: #fafafb;
  color: var(--text-muted);
  font-size: 12px;
  transition: all 0.2s ease;
}

.file-picker__dropzone:hover {
  border-color: var(--primary);
  background: var(--primary-bg);
}

.picker-icon {
  color: var(--text-muted);
}

.field-error {
  margin: 0;
  font-size: 11.5px;
  color: #dc2626;
  background: #fef2f2;
  padding: 6px 10px;
  border-radius: 6px;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.btn-cancel {
  padding: 8px 16px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-secondary);
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.btn-cancel:hover { background: var(--page-bg-accent); }

.btn-submit {
  padding: 8px 18px;
  border: none;
  background: var(--primary);
  color: #fff;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}

.btn-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Chunks 抽屉样式 */
.drawer-backdrop {
  justify-content: flex-end;
  padding: 0;
}

.drawer {
  width: 100%;
  max-width: 480px;
  height: 100%;
  background: #ffffff;
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  animation: slide-in 0.2s ease-out;
}

@keyframes slide-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.drawer-head {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-muted);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.drawer-title-stack {
  min-width: 0;
}

.drawer-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.drawer-subtitle {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.drawer-loading,
.drawer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 240px;
  color: var(--text-muted);
}

.chunk-card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chunk-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: #fafafb;
  transition: all 0.2s ease;
}

.chunk-card--disabled {
  opacity: 0.6;
  border-color: rgba(226, 232, 240, 0.4);
  background: #f8fafc;
}

.chunk-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.chunk-idx {
  font-weight: 700;
  color: var(--primary);
  background: var(--primary-bg);
  padding: 1px 6px;
  border-radius: 4px;
}

.chunk-char {
  font-variant-numeric: tabular-nums;
}

.toggle-switch {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.toggle-switch input {
  accent-color: var(--primary);
}

.toggle-label {
  font-size: 10.5px;
  font-weight: 600;
}

.chunk-card__body {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
  max-height: 160px;
  overflow-y: auto;
  font-family: inherit;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .filters-grid {
    grid-template-columns: 1fr;
  }
}
</style>
