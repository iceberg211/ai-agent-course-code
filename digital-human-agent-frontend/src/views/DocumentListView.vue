<template>
  <main class="document-list">
    <header class="page-head">
      <div>
        <h2>文档管理</h2>
        <p class="subtitle">统一查看和控制所有知识库中的文档解析、多模态资产与数据安全隔离</p>
      </div>
      <button v-if="canUploadDocuments" class="btn-primary" type="button" @click="openUploadModal(null)">
        <PlusIcon :size="15" />
        <span>上传文档 & 新建任务</span>
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
            <option value="video">视频文件</option>
            <option value="audio">音频文件</option>
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
            <option value="failed">同步失败</option>
            <option value="skipped">已跳过</option>
          </select>
        </label>

        <label class="filter-field">
          <span>处理阶段</span>
          <select v-model="query.processingStage" @change="refreshList">
            <option value="">全部阶段</option>
            <option value="uploaded">已上传</option>
            <option value="parsing">解析中</option>
            <option value="chunking">分片中</option>
            <option value="embedding">向量写入中</option>
            <option value="keyword_indexing">关键词索引中</option>
            <option value="graph_indexing">图谱同步中</option>
            <option value="completed">完成</option>
            <option value="failed">失败</option>
          </select>
        </label>

        <label class="filter-field">
          <span>可见范围</span>
          <select v-model="query.visibility" @change="refreshList">
            <option value="">全部范围</option>
            <option value="company">全公司</option>
            <option value="department">本部门</option>
            <option value="private">仅作者</option>
          </select>
        </label>

        <label class="filter-field">
          <span>部门</span>
          <input v-model="query.department" type="text" placeholder="输入部门" @input="onSearchInput" />
        </label>

        <label class="filter-field">
          <span>业务分类</span>
          <input v-model="query.businessCategory" type="text" placeholder="输入分类" @input="onSearchInput" />
        </label>

        <label class="filter-field">
          <span>标签</span>
          <input v-model="query.tags" type="text" placeholder="多个标签用逗号分隔" @input="onSearchInput" />
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
        <button v-if="canUploadDocuments" class="btn-ghost" type="button" @click="openUploadModal(null)">上传第一个文档</button>
      </div>

      <div v-else class="table-container">
        <table class="doc-table">
          <thead>
            <tr>
              <th scope="col">文档名称</th>
              <th scope="col">所属知识库</th>
              <th scope="col">大小/类型</th>
              <th scope="col">版本与安全</th>
              <th scope="col">解析状态</th>
              <th scope="col">图谱状态</th>
              <th scope="col">切片/资产</th>
              <th scope="col" class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in items" :key="doc.id">
              <td class="cell-filename">
                <div class="filename-wrapper" :title="doc.filename" @click="inspectDetail(doc)">
                  <FileTextIcon :size="15" class="doc-icon" />
                  <strong>{{ doc.filename }}</strong>
                </div>
              </td>
              <td>
                <span class="kb-badge" :title="doc.knowledge?.name || '未知'">
                  {{ doc.knowledge?.name || '未知' }}
                </span>
              </td>
              <td>
                <span class="meta-desc">
                  {{ formatSize(doc.fileSize ?? doc.file_size) }} · {{ formatType(doc.filename) }}
                </span>
              </td>
              <td>
                <div class="version-acl-stack">
                  <span class="version-label">v{{ doc.version ?? 1 }}</span>
                  <span class="visibility-badge" :class="'vis--' + (doc.visibility || 'company')">
                    {{ doc.visibility === 'private' ? '仅作者' : doc.visibility === 'department' ? '本部门' : '全公司' }}
                  </span>
                  <span v-if="doc.securityLevel" class="security-level-pill">Level {{ doc.securityLevel }}</span>
                </div>
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
                <div class="assets-chunks-counter">
                  <span class="chunks-num">{{ doc.chunkCount ?? doc.chunk_count ?? 0 }} 段</span>
                  <span v-if="doc.assetCount" class="assets-num">{{ doc.assetCount }} 资源</span>
                </div>
              </td>
              <td class="text-right cell-actions">
                <button
                  class="action-btn"
                  title="查看详情与多模态资产"
                  type="button"
                  @click="inspectDetail(doc)"
                >
                  <EyeIcon :size="14" />
                </button>
                
                <button
                  v-if="isFailed(doc) && canRetryDocuments"
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
                  title="查看处理任务"
                  type="button"
                  @click="openLatestTask(doc)"
                >
                  <ListChecksIcon :size="14" />
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
                  v-if="canDeleteDocuments"
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

        <!-- 分页 -->
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

    <!-- 1. 新建：文档上传抽屉 -->
    <DocumentUploadDrawer
      :open="uploadOpen"
      :kbs="kbs"
      :default-kb-id="uploadTargetKbId"
      @close="uploadOpen = false"
      @uploaded="onDocumentUploaded"
      @inspect-task="openTaskDetailFromDrawer"
    />

    <!-- 2. 新建：文档详情与分片治理抽屉 -->
    <DocumentDetailDrawer
      :open="detailOpen"
      :doc="activeDoc"
      :can-upload="canUploadDocuments"
      :can-set-current-version="canSetCurrentVersion"
      :can-archive="canArchiveDocuments"
      @close="detailOpen = false"
      @updated="refreshList"
    />

    <!-- 3. 新建：解析任务追踪弹窗 -->
    <DocumentTaskModal
      :open="taskDetailOpen"
      :doc="activeDoc"
      :task-id="activeTaskId"
      @close="taskDetailOpen = false"
    />
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  EyeIcon,
  FileTextIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { usePermissions } from '@/hooks/usePermissions'
import { useDocumentFilters } from '@/hooks/useDocumentFilters'
import { KNOWLEDGE_DOCUMENT_STATUS_LABELS } from '@/common/constants'
import type { KnowledgeBase, KnowledgeDocumentDetail } from '@/types'

// 导入拆分后的子组件
import DocumentUploadDrawer from '@/components/document/DocumentUploadDrawer.vue'
import DocumentDetailDrawer from '@/components/document/DocumentDetailDrawer.vue'
import DocumentTaskModal from '@/components/document/DocumentTaskModal.vue'

const router = useRouter()
const route = useRoute()
const kbApi = useKnowledgeBase()
const kbStore = useKnowledgeBaseStore()
const permissionApi = usePermissions()

const items = ref<KnowledgeDocumentDetail[]>([])
const kbs = ref<KnowledgeBase[]>([])
const total = ref(0)
const retryingId = ref('')

const canUploadDocuments = computed(() => permissionApi.can('documents:upload'))
const canRetryDocuments = computed(() => permissionApi.can('documents:retry'))
const canDeleteDocuments = computed(() => permissionApi.can('documents:delete'))
const canArchiveDocuments = computed(() => permissionApi.can('documents:archive'))
const canSetCurrentVersion = computed(() => permissionApi.can('documents:version:set-current'))

// 接入联合筛选 Hook
const { query, onSearchInput, resetFilters, applyRouteQuery } = useDocumentFilters(refreshList)

const maxPage = computed(() => Math.max(1, Math.ceil(total.value / query.pageSize)))

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
  applyRouteQuery()
  void permissionApi.loadPermissions()
  loadKbs()
  refreshList()
})

function changePage(p: number) {
  if (p < 1 || p > maxPage.value) return
  query.page = p
  refreshList()
}

// 模态弹窗与抽屉控制桥梁
const uploadOpen = ref(false)
const uploadTargetKbId = ref('')

const detailOpen = ref(false)
const activeDoc = ref<KnowledgeDocumentDetail | null>(null)

const taskDetailOpen = ref(false)
const activeTaskId = ref<string | null>(null)

function openUploadModal(kbId: string | null) {
  uploadTargetKbId.value = kbId || ''
  uploadOpen.value = true
}

function onDocumentUploaded() {
  // 上传成功触发主列表刷新
  refreshList()
}

function openTaskDetailFromDrawer(taskId: string) {
  activeTaskId.value = taskId
  activeDoc.value = null
  taskDetailOpen.value = true
}

function inspectDetail(doc: KnowledgeDocumentDetail) {
  activeDoc.value = doc
  detailOpen.value = true
}

function openLatestTask(doc: KnowledgeDocumentDetail) {
  activeDoc.value = doc
  activeTaskId.value = null // 置空以便任务弹窗从 activeDoc 获取第一条任务
  taskDetailOpen.value = true
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

function isFailed(doc: KnowledgeDocumentDetail): boolean {
  return doc.status === 'failed' || doc.graphSyncStatus === 'failed' || doc.graph_sync_status === 'failed'
}

function canRetrySync(doc: KnowledgeDocumentDetail): boolean {
  const count = doc.chunkCount ?? doc.chunk_count ?? 0
  return count > 0
}

async function handleFailedDocAction(doc: KnowledgeDocumentDetail) {
  const kbId = doc.knowledgeBaseId || doc.knowledge_base_id
  if (!kbId) return
  
  if (canRetrySync(doc)) {
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
    openUploadModal(kbId)
  }
}

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

// 格式化展示助手函数
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

function statusLabelOf(status?: string): string {
  if (status === 'running') return '处理中'
  if (status === 'skipped') return '已跳过'
  return KNOWLEDGE_DOCUMENT_STATUS_LABELS[status || 'pending'] ?? '未知'
}

function statusClassOf(status?: string): string {
  if (status === 'completed') return 'pill--success'
  if (status === 'failed') return 'pill--error'
  if (status === 'processing' || status === 'running' || status === 'pending') return 'pill--warning'
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
  parsing: '多模态解析',
  chunking: '分片切分',
  embedding: '向量检索索引',
  keyword_indexing: '全文检索索引',
  graph_indexing: '知识图谱建图',
  completed: '成功',
  failed: '失败',
}

function stageLabelOf(stage?: string): string {
  return (stageLabels[stage || ''] ?? stage) || '排队'
}
</script>

<style scoped>
.document-list {
  padding: 24px;
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
}

.btn-ghost {
  border: none;
  background: transparent;
  color: var(--primary);
  font-weight: 700;
  cursor: pointer;
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
}

.filters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: left;
}

.filter-field span {
  font-weight: 700;
}

select, input[type="text"] {
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text);
  outline: none;
  font-size: 13px;
}

select:focus, input[type="text"]:focus {
  border-color: var(--primary);
}

.filters-actions {
  display: flex;
  justify-content: flex-end;
}

.btn-reset {
  padding: 8px 16px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-reset:hover {
  background: #f8fafc;
  border-color: var(--primary-muted);
  color: var(--primary);
}

/* 列表 Section */
.list-section {
  flex: 1;
}

.state-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 32px;
  background: rgba(255, 255, 255, 0.65);
  border-radius: var(--radius-lg, 12px);
  border: 1.5px dashed var(--border);
  color: var(--text-muted);
  font-size: 13px;
  gap: 12px;
}

.placeholder-icon {
  color: var(--text-muted);
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(59, 130, 246, 0.2);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.table-container {
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 0 4px 20px rgba(15, 23, 42, 0.015);
  overflow-x: auto;
}

.doc-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.doc-table th, .doc-table td {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
}

.doc-table th {
  background: #f8fafc;
  font-size: 11.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.cell-filename {
  max-width: 260px;
}

.filename-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  min-width: 0;
}

.filename-wrapper strong {
  font-size: 13.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filename-wrapper:hover strong {
  color: var(--primary);
}

.doc-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.kb-badge {
  display: inline-block;
  padding: 2px 8px;
  background: #f1f5f9;
  color: #475569;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-desc {
  font-size: 12px;
  color: var(--text-muted);
}

.version-acl-stack {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.version-label {
  font-size: 10.5px;
  font-weight: 800;
  color: var(--primary);
  background: var(--primary-bg);
  padding: 1px 6px;
  border-radius: 4px;
}

.visibility-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}

.vis--company { background: #f0fdf4; color: #166534; }
.vis--department { background: #fef9c3; color: #854d0e; }
.vis--private { background: #f1f5f9; color: #475569; }

.security-level-pill {
  background: #fef2f2;
  color: #991b1b;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}

.status-indicator-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.stage-sub {
  font-size: 9.5px;
  font-weight: 600;
  opacity: 0.85;
}

.pill--success { background: #ecfdf5; color: #059669; }
.pill--warning { background: #fffbeb; color: #d97706; }
.pill--error { background: #fef2f2; color: #dc2626; }
.pill--secondary { background: #f1f5f9; color: #475569; }

.assets-chunks-counter {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11.5px;
}

.chunks-num {
  font-weight: 700;
  color: var(--text-secondary);
}

.assets-num {
  color: var(--text-muted);
}

.cell-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.action-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover {
  border-color: rgba(59, 130, 246, 0.4);
  color: var(--primary);
  background: #f8fafc;
}

.action-btn--danger:hover {
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--error);
  background: #fef2f2;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spin-icon {
  animation: spin 0.8s linear infinite;
}

/* 分页 */
.pagination {
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f8fafc;
  border-top: 1px solid var(--border);
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
  padding: 5px 12px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
}

.pagination-btn:hover:not(:disabled) {
  background: #f8fafc;
  color: var(--primary);
  border-color: var(--primary-muted);
}

.pagination-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pagination-page {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 600;
}
</style>
