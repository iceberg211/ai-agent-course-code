<template>
  <main class="p-6 h-full overflow-y-auto bg-transparent flex flex-col gap-5 w-full box-border">
    <header class="flex items-center justify-between gap-5 text-left">
      <div>
        <h2 class="m-0 mb-1 text-2xl font-extrabold text-text-main tracking-tight">文档管理</h2>
        <p class="m-0 text-xs text-text-muted">统一查看和控制所有知识库中的文档解析、多模态资产与数据安全隔离</p>
      </div>
      <button v-if="canUploadDocuments" class="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none rounded-lg text-xs font-bold cursor-pointer shadow-btn transition-all duration-200 hover:brightness-104 hover:-translate-y-[0.5px]" type="button" @click="openUploadModal(null)">
        <PlusIcon :size="15" />
        <span>上传文档 & 新建任务</span>
      </button>
    </header>

    <!-- 联合筛选区 -->
    <section class="flex flex-col gap-4 p-5 bg-white/65 backdrop-blur-md border border-white/50 rounded-xl" aria-label="筛选面板">
      <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <label class="flex flex-col gap-1.5 text-[11px] text-text-secondary text-left font-bold">
          <span>搜索文档</span>
          <input
            v-model="query.q"
            type="text"
            class="h-9.5 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary focus:ring-3 focus:ring-border-focus transition-all"
            placeholder="输入文件名模糊搜索…"
            @input="onSearchInput"
          />
        </label>

        <label class="flex flex-col gap-1.5 text-[11px] text-text-secondary text-left font-bold">
          <span>所属知识库</span>
          <select v-model="query.knowledgeBaseId" class="h-9.5 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary transition-all" @change="refreshList">
            <option value="">全部知识库</option>
            <option v-for="kb in kbs" :key="kb.id" :value="kb.id">
              {{ kb.name }}
            </option>
          </select>
        </label>

        <label class="flex flex-col gap-1.5 text-[11px] text-text-secondary text-left font-bold">
          <span>文件类型</span>
          <select v-model="query.fileType" class="h-9.5 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary transition-all" @change="refreshList">
            <option value="">全部类型</option>
            <option value="pdf">PDF</option>
            <option value="md">Markdown (.md)</option>
            <option value="txt">文本 (.txt)</option>
            <option value="video">视频文件</option>
            <option value="audio">音频文件</option>
          </select>
        </label>

        <label class="flex flex-col gap-1.5 text-[11px] text-text-secondary text-left font-bold">
          <span>解析状态</span>
          <select v-model="query.status" class="h-9.5 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary transition-all" @change="refreshList">
            <option value="">全部状态</option>
            <option value="pending">排队中</option>
            <option value="processing">处理中</option>
            <option value="completed">就绪</option>
            <option value="failed">失败</option>
          </select>
        </label>

        <label class="flex flex-col gap-1.5 text-[11px] text-text-secondary text-left font-bold">
          <span>图谱同步</span>
          <select v-model="query.graphStatus" class="h-9.5 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary transition-all" @change="refreshList">
            <option value="">全部状态</option>
            <option value="pending">排队中</option>
            <option value="indexed">已同步</option>
            <option value="failed">同步失败</option>
            <option value="skipped">已跳过</option>
          </select>
        </label>

        <label class="flex flex-col gap-1.5 text-[11px] text-text-secondary text-left font-bold">
          <span>处理阶段</span>
          <select v-model="query.processingStage" class="h-9.5 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary transition-all" @change="refreshList">
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

        <label class="flex flex-col gap-1.5 text-[11px] text-text-secondary text-left font-bold">
          <span>可见范围</span>
          <select v-model="query.visibility" class="h-9.5 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary transition-all" @change="refreshList">
            <option value="">全部范围</option>
            <option value="company">全公司</option>
            <option value="department">本部门</option>
            <option value="private">仅作者</option>
          </select>
        </label>

        <label class="flex flex-col gap-1.5 text-[11px] text-text-secondary text-left font-bold">
          <span>部门</span>
          <input v-model="query.department" type="text" class="h-9.5 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary focus:ring-3 focus:ring-border-focus transition-all" placeholder="输入部门" @input="onSearchInput" />
        </label>

        <label class="flex flex-col gap-1.5 text-[11px] text-text-secondary text-left font-bold">
          <span>业务分类</span>
          <input v-model="query.businessCategory" type="text" class="h-9.5 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary focus:ring-3 focus:ring-border-focus transition-all" placeholder="输入分类" @input="onSearchInput" />
        </label>

        <label class="flex flex-col gap-1.5 text-[11px] text-text-secondary text-left font-bold">
          <span>标签</span>
          <input v-model="query.tags" type="text" class="h-9.5 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary focus:ring-3 focus:ring-border-focus transition-all" placeholder="多个标签用逗号分隔" @input="onSearchInput" />
        </label>
      </div>

      <div class="flex justify-end">
        <button class="px-4 py-2 border border-border-main bg-white rounded-lg text-xs font-bold text-text-secondary cursor-pointer transition-all hover:bg-slate-50 hover:border-primary-muted hover:text-primary" type="button" @click="resetFilters">
          重置筛选
        </button>
      </div>
    </section>

    <!-- 列表展示区 -->
    <section class="flex-1">
      <div v-if="kbApi.documentsLoading.value && items.length === 0" class="flex flex-col items-center justify-center p-16 bg-white/65 rounded-xl border border-dashed border-border-main text-text-muted text-xs gap-3">
        <div class="w-7 h-7 border-3 border-blue-500/20 border-t-primary rounded-full animate-spin"></div>
        <p>正在拉取文档清单…</p>
      </div>

      <div v-else-if="items.length === 0" class="flex flex-col items-center justify-center p-16 bg-white/65 rounded-xl border border-dashed border-border-main text-text-muted text-xs gap-3">
        <FileTextIcon :size="28" class="text-text-muted" />
        <p>没有找到符合筛选条件的文档</p>
        <button v-if="canUploadDocuments" class="bg-transparent border-none text-primary font-bold cursor-pointer hover:underline" type="button" @click="openUploadModal(null)">上传第一个文档</button>
      </div>

      <div v-else class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl shadow-[0_4px_20px_rgba(15,23,42,0.015)] overflow-x-auto">
        <table class="w-full border-collapse text-left">
          <thead>
            <tr>
              <th scope="col" class="p-3.5 px-5 border-b border-border-main bg-slate-50 text-[11px] font-extrabold uppercase tracking-wider text-text-muted">文档名称</th>
              <th scope="col" class="p-3.5 px-5 border-b border-border-main bg-slate-50 text-[11px] font-extrabold uppercase tracking-wider text-text-muted">所属知识库</th>
              <th scope="col" class="p-3.5 px-5 border-b border-border-main bg-slate-50 text-[11px] font-extrabold uppercase tracking-wider text-text-muted">大小/类型</th>
              <th scope="col" class="p-3.5 px-5 border-b border-border-main bg-slate-50 text-[11px] font-extrabold uppercase tracking-wider text-text-muted">版本与安全</th>
              <th scope="col" class="p-3.5 px-5 border-b border-border-main bg-slate-50 text-[11px] font-extrabold uppercase tracking-wider text-text-muted">解析状态</th>
              <th scope="col" class="p-3.5 px-5 border-b border-border-main bg-slate-50 text-[11px] font-extrabold uppercase tracking-wider text-text-muted">图谱状态</th>
              <th scope="col" class="p-3.5 px-5 border-b border-border-main bg-slate-50 text-[11px] font-extrabold uppercase tracking-wider text-text-muted">切片/资产</th>
              <th scope="col" class="p-3.5 px-5 border-b border-border-main bg-slate-50 text-[11px] font-extrabold uppercase tracking-wider text-text-muted text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in items" :key="doc.id">
              <td class="p-3.5 px-5 border-b border-border-main max-w-[260px]">
                <div class="flex items-center gap-2.5 cursor-pointer min-w-0 group" @click="inspectDetail(doc)">
                  <FileTextIcon :size="15" class="text-text-muted shrink-0" />
                  <strong class="text-[13px] font-bold text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap group-hover:text-primary transition-colors" :title="doc.filename">{{ doc.filename }}</strong>
                </div>
              </td>
              <td class="p-3.5 px-5 border-b border-border-main">
                <span class="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 rounded-[6px] text-[10.5px] font-bold max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap" :title="doc.knowledge?.name || '未知'">
                  {{ doc.knowledge?.name || '未知' }}
                </span>
              </td>
              <td class="p-3.5 px-5 border-b border-border-main">
                <span class="text-xs text-text-muted">
                  {{ formatSize(doc.fileSize ?? doc.file_size) }} · {{ formatType(doc.filename) }}
                </span>
              </td>
              <td class="p-3.5 px-5 border-b border-border-main">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-[10px] font-black text-primary bg-primary-bg px-1.5 py-0.5 rounded-[4px]">v{{ doc.version ?? 1 }}</span>
                  <span class="text-[9.5px] font-bold px-1.5 py-0.5 rounded-[4px]" :class="doc.visibility === 'private' ? 'bg-slate-100 text-slate-700' : doc.visibility === 'department' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'">
                    {{ doc.visibility === 'private' ? '仅作者' : doc.visibility === 'department' ? '本部门' : '全公司' }}
                  </span>
                  <span v-if="doc.securityLevel" class="bg-red-55/10 text-red-800 text-[9.5px] font-bold px-1.5 py-0.5 rounded-[4px]">Level {{ doc.securityLevel }}</span>
                </div>
              </td>
              <td class="p-3.5 px-5 border-b border-border-main">
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10.5px] font-bold whitespace-nowrap" :class="statusClassOf(doc.status)">
                  {{ statusLabelOf(doc.status) }}
                  <span v-if="doc.processingStage || doc.processing_stage" class="text-[9.5px] font-semibold opacity-85">
                    ({{ stageLabelOf(doc.processingStage || doc.processing_stage) }})
                  </span>
                </span>
              </td>
              <td class="p-3.5 px-5 border-b border-border-main">
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10.5px] font-bold whitespace-nowrap" :class="graphStatusClassOf(doc.graphSyncStatus || doc.graph_sync_status)">
                  {{ graphStatusLabelOf(doc.graphSyncStatus || doc.graph_sync_status) }}
                </span>
              </td>
              <td class="p-3.5 px-5 border-b border-border-main">
                <div class="flex flex-col gap-0.5 text-[11px]">
                  <span class="font-bold text-text-secondary">{{ doc.chunkCount ?? doc.chunk_count ?? 0 }} 段</span>
                  <span v-if="doc.assetCount" class="text-text-muted">{{ doc.assetCount }} 资源</span>
                </div>
              </td>
              <td class="p-3.5 px-5 border-b border-border-main text-right">
                <div class="flex items-center justify-end gap-1">
                  <button
                    class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer transition-all hover:border-primary/45 hover:text-primary hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="查看详情与多模态资产"
                    type="button"
                    @click="inspectDetail(doc)"
                  >
                    <EyeIcon :size="14" />
                  </button>
                  
                  <button
                    v-if="isFailed(doc) && canRetryDocuments"
                    class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer transition-all hover:border-primary/45 hover:text-primary hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    :title="canRetrySync(doc) ? '重试图谱与索引同步' : '重新上传原文件'"
                    type="button"
                    :disabled="retryingId === doc.id"
                    @click="handleFailedDocAction(doc)"
                  >
                    <RefreshCwIcon :size="14" :class="{ 'animate-spin': retryingId === doc.id }" />
                  </button>

                  <button
                    class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer transition-all hover:border-primary/45 hover:text-primary hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="查看处理任务"
                    type="button"
                    @click="openLatestTask(doc)"
                  >
                    <ListChecksIcon :size="14" />
                  </button>

                  <button
                    class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer transition-all hover:border-primary/45 hover:text-primary hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="去问答验证"
                    type="button"
                    @click="goToChatValidation(doc)"
                  >
                    <MessageSquareIcon :size="14" />
                  </button>

                  <button
                    v-if="canDeleteDocuments"
                    class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer transition-all hover:border-red-500/30 hover:text-error hover:bg-red-55/5 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="删除文档"
                    type="button"
                    @click="deleteDoc(doc)"
                  >
                    <Trash2Icon :size="14" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- 分页 -->
        <footer class="p-3.5 px-5 flex items-center justify-between bg-slate-50 border-t border-border-main">
          <span class="text-xs text-text-muted">共 {{ total }} 条记录</span>
          <div class="flex items-center gap-3">
            <button
              :disabled="query.page === 1"
              class="p-1 px-3 border border-border-main bg-white rounded-md text-[11.5px] font-semibold text-text-secondary cursor-pointer hover:bg-slate-50 hover:text-primary hover:border-primary-muted disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
              @click="changePage(query.page - 1)"
            >
              上一页
            </button>
            <span class="text-xs text-text-secondary font-semibold">第 {{ query.page }} / {{ maxPage }} 页</span>
            <button
              :disabled="query.page >= maxPage"
              class="p-1 px-3 border border-border-main bg-white rounded-md text-[11.5px] font-semibold text-text-secondary cursor-pointer hover:bg-slate-50 hover:text-primary hover:border-primary-muted disabled:opacity-50 disabled:cursor-not-allowed"
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

// 上传成功触发主列表刷新
function onDocumentUploaded() {
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
