<template>
  <Teleport to="body">
    <div v-if="open && doc" class="drawer-backdrop" @click.self="$emit('close')">
      <aside class="drawer drawer--large drawer--right">
        <header class="drawer-head">
          <div class="drawer-title-stack">
            <h3>知识资产详情</h3>
            <p class="drawer-subtitle" :title="doc.filename">{{ doc.filename }}</p>
          </div>
          <button class="drawer-close" type="button" @click="$emit('close')">
            <XIcon :size="16" />
          </button>
        </header>

        <section class="asset-overview-strip" aria-label="文档状态摘要">
          <article>
            <span>解析状态</span>
            <strong :class="statusClassOf(doc.status)">{{ statusLabelOf(doc.status) }}</strong>
          </article>
          <article>
            <span>处理阶段</span>
            <strong>{{ stageLabelOf(doc.processingStage || doc.processing_stage) }}</strong>
          </article>
          <article>
            <span>切片</span>
            <strong>{{ doc.chunkCount ?? doc.chunk_count ?? 0 }}</strong>
          </article>
          <article>
            <span>多模态资源</span>
            <strong>{{ doc.assetCount ?? doc.asset_count ?? 0 }}</strong>
          </article>
          <article>
            <span>可见范围</span>
            <strong>{{ visibilityLabelOf(doc.visibility) }}</strong>
          </article>
        </section>

        <div class="drawer-tabs">
          <button 
            v-for="t in detailTabs" 
            :key="t.key" 
            class="tab-btn" 
            :class="{ 'tab-btn--active': activeDetailTab === t.key }"
            @click="switchDetailTab(t.key)"
          >
            {{ t.label }}
          </button>
        </div>

        <div class="drawer-body">
          <!-- Tab 1: 基础属性 & 安全治理 -->
          <div v-if="activeDetailTab === 'info'" class="detail-info-pane">
            <div class="info-grid">
              <div class="info-item">
                <span class="lbl">文档 ID</span>
                <span class="val font-mono">{{ doc.id }}</span>
              </div>
              <div class="info-item">
                <span class="lbl">所处阶段</span>
                <span class="val">
                  <span class="status-indicator-pill" :class="statusClassOf(doc.status)">
                    {{ statusLabelOf(doc.status) }} ({{ stageLabelOf(doc.processingStage || doc.processing_stage) }})
                  </span>
                </span>
              </div>
              <div class="info-item">
                <span class="lbl">大小/类型</span>
                <span class="val">{{ formatSize(doc.fileSize ?? doc.file_size) }} ({{ formatType(doc.filename) }})</span>
              </div>
              <div class="info-item">
                <span class="lbl">入库时间</span>
                <span class="val">{{ formatDateTime(doc.createdAt || doc.created_at) }}</span>
              </div>
            </div>

            <!-- 权限及治理动态更新 -->
            <div class="section-divider">动态安全治理控制</div>
            <form @submit.prevent="saveGovernance" class="gov-form">
              <div class="field">
                <label class="label">数据可见性范围 (Visibility)</label>
                <select v-model="govForm.visibility">
                  <option value="company">全公司可见 (Company)</option>
                  <option value="department">本部门可见 (Department)</option>
                  <option value="private">仅上传者可见 (Private)</option>
                </select>
              </div>
              <div class="field-row">
                <div class="field">
                  <label class="label">安全密级</label>
                  <select v-model.number="govForm.securityLevel">
                    <option :value="0">公开 (Level 0)</option>
                    <option :value="1">内部敏感 (Level 1)</option>
                    <option :value="2">核心机密 (Level 2)</option>
                  </select>
                </div>
                <div class="field">
                  <label class="label">归属部门</label>
                  <input type="text" v-model="govForm.department" />
                </div>
              </div>
              <div class="field">
                <label class="label">标签列表 (逗号分隔)</label>
                <input type="text" v-model="govForm.tags" />
              </div>
              <div class="field">
                <label class="label">业务分类</label>
                <input type="text" v-model="govForm.businessCategory" />
              </div>
              <div class="field">
                <label class="label">过期时间</label>
                <input type="date" v-model="govForm.expiresAt" />
              </div>
              <button v-if="canUpload" type="submit" class="btn-primary" :disabled="govSaving">
                {{ govSaving ? '保存中…' : '应用安全设置' }}
              </button>
            </form>
          </div>

          <!-- Tab 2: 处理任务 -->
          <div v-if="activeDetailTab === 'tasks'" class="detail-tasks-pane">
            <div v-if="tasksLoading" class="loader-box">
              <div class="spinner"></div>
              <p>读取处理任务与步骤…</p>
            </div>
            <div v-else-if="docTasks.length === 0" class="empty-box">
              <p>该文档暂无处理任务记录</p>
            </div>
            <ol v-else class="task-timeline">
              <li v-for="task in docTasks" :key="task.id" class="task-record">
                <header class="task-record__head">
                  <div>
                    <strong>{{ taskTypeLabelOf(task.taskType || task.task_type) }}</strong>
                    <span>ID: {{ task.id }}</span>
                  </div>
                  <span class="status-indicator-pill" :class="statusClassOf(task.status)">
                    {{ statusLabelOf(task.status) }}
                  </span>
                </header>
                <div class="task-record__meta">
                  <span>阶段：{{ stageLabelOf(task.stage) }}</span>
                  <span>进度：{{ task.progress ?? 0 }}%</span>
                  <span>开始：{{ formatDateTime(task.startedAt || task.started_at || task.createdAt || task.created_at) }}</span>
                  <span>结束：{{ formatDateTime(task.finishedAt || task.finished_at) }}</span>
                </div>
                <p v-if="task.error" class="task-record__error">{{ task.error }}</p>

                <ol v-if="task.steps?.length" class="task-step-inline-list">
                  <li v-for="step in task.steps" :key="`${task.id}-${step.step}`">
                    <span class="step-dot" :class="stepStatusClassOf(step.status)" />
                    <strong>{{ taskStepLabelOf(step.step) }}</strong>
                    <small>{{ statusLabelOf(step.status) }}</small>
                    <em>{{ formatDuration(step.startedAt || step.started_at, step.finishedAt || step.finished_at) }}</em>
                    <p v-if="step.error">{{ step.error }}</p>
                  </li>
                </ol>
              </li>
            </ol>
          </div>

          <!-- Tab 3: Markdown 预览 -->
          <div v-if="activeDetailTab === 'markdown'" class="detail-markdown-pane">
            <div v-if="markdownLoading" class="loader-box">
              <div class="spinner"></div>
              <p>读取 Markdown 格式化排版中…</p>
            </div>
            <div v-else-if="!docMarkdown" class="empty-box">
              <p>解析产物暂时为空</p>
            </div>
            <div v-else class="markdown-preview-box">
              <pre class="md-raw">{{ docMarkdown }}</pre>
            </div>
          </div>

          <!-- Tab 4: 多模态解析资产 -->
          <div v-if="activeDetailTab === 'assets'" class="detail-assets-pane">
            <div v-if="assetsLoading" class="loader-box">
              <div class="spinner"></div>
              <p>提取多模态资产切片中…</p>
            </div>
            <div v-else-if="docAssets.length === 0" class="empty-box">
              <p>该文档无音视频或图片等多模态资产</p>
            </div>
            <div v-else class="assets-grid">
              <div v-for="asset in docAssets" :key="asset.id" class="asset-detail-card">
                <div class="header">
                  <span class="badge" :class="'badge--' + asset.assetType">{{ asset.assetType }}</span>
                  <span class="font-mono text-muted">ID: {{ asset.id.slice(0, 8) }}</span>
                </div>
                
                <div class="body">
                  <!-- 图片预览 -->
                  <div v-if="asset.assetType === 'image'" class="image-box">
                    <img v-if="assetUrl(asset)" :src="assetUrl(asset)" class="asset-img" />
                    <div v-else class="asset-fallback">图片预览暂不可用</div>
                  </div>
                  <!-- 视频帧与时间戳 -->
                  <div v-else-if="asset.assetType === 'video'" class="video-box">
                    <video v-if="assetUrl(asset)" controls :src="assetUrl(asset)" class="mini-video-player"></video>
                    <div v-else class="asset-fallback">视频预览暂不可用</div>
                    <div class="time-tag">时间: {{ formatTime(asset.startMs ?? asset.start_ms) }} - {{ formatTime(asset.endMs ?? asset.end_ms) }}</div>
                  </div>
                  <!-- 音频 -->
                  <div v-else-if="asset.assetType === 'audio'" class="audio-box">
                    <audio v-if="assetUrl(asset)" controls :src="assetUrl(asset)" class="mini-audio-player"></audio>
                    <div v-else class="asset-fallback">音频预览暂不可用</div>
                  </div>

                  <div class="asset-meta">
                    <span :title="asset.filename || asset.storageKey || asset.storage_key">
                      {{ asset.filename || asset.storageKey || asset.storage_key }}
                    </span>
                    <span v-if="asset.pageNo || asset.page_no">第 {{ asset.pageNo ?? asset.page_no }} 页</span>
                  </div>

                  <!-- OCR 文字与描述 -->
                  <div class="caption-text" v-if="asset.ocrText || asset.ocr_text || asset.caption">
                    <strong>识别描述/OCR:</strong>
                    <p>{{ asset.ocrText || asset.ocr_text || asset.caption }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Tab 5: 知识图谱实体与 Chunks -->
          <div v-if="activeDetailTab === 'chunks'" class="detail-chunks-pane">
            <div v-if="chunksLoading" class="loader-box">
              <div class="spinner"></div>
              <p>查询实体关联切片中…</p>
            </div>
            <ul v-else-if="chunks.length === 0" class="empty-box">
              <p>该文档尚未拆分切片</p>
            </ul>
            <ul v-else class="chunk-card-list">
              <li v-for="c in chunks" :key="c.id" class="chunk-card" :class="{ 'chunk-card--disabled': !c.enabled }">
                <header class="chunk-card__head">
                  <span class="chunk-idx">§ {{ c.chunkIndex + 1 }}</span>
                  <span class="chunk-char">{{ c.content.length }} 字</span>
                  <label v-if="canUpload" class="toggle-switch">
                    <input type="checkbox" :checked="c.enabled" @change="toggleChunk(c)" />
                    <span class="toggle-label">{{ c.enabled ? '已启用' : '已禁用' }}</span>
                  </label>
                </header>
                <pre class="chunk-card__body">{{ c.content }}</pre>
              </li>
            </ul>
          </div>

          <!-- Tab 6: 版本历史与更替 -->
          <div v-if="activeDetailTab === 'history'" class="detail-history-pane">
            <div class="history-upload-section">
              <h4>更替上传新版本 (v{{ (doc.version ?? 1) + 1 }})</h4>
              <div class="field-row">
                <input type="file" @change="onVersionFileSelected" accept=".txt,.md,.pdf,.docx,.xlsx,.pptx" />
                <button v-if="canUpload" class="btn-primary" :disabled="!versionFile || versionUploading" @click="submitVersionUpload">
                  {{ versionUploading ? '上传新版本中…' : '上传此版本' }}
                </button>
              </div>
            </div>

            <div class="section-divider">版本迭代历史</div>
            <div v-if="versionsLoading" class="loader-box"><div class="spinner"></div></div>
            <ul v-else class="version-list">
              <li v-for="ver in docVersions" :key="ver.id" class="version-item" :class="{ 'is-current': ver.isCurrentVersion || ver.is_current_version }">
                <div class="v-header">
                  <strong>Version v{{ ver.version ?? 1 }}</strong>
                  <span class="current-badge" v-if="ver.isCurrentVersion || ver.is_current_version">当前版本</span>
                  <span class="archived-badge" v-if="ver.archivedAt || ver.archived_at">已归档</span>
                </div>
                <div class="v-meta font-mono">
                  ID: {{ ver.id }} · 创建时间: {{ formatDateTime(ver.createdAt || ver.created_at) }}
                </div>
                <div class="v-actions" v-if="!ver.isCurrentVersion && !ver.is_current_version && !ver.archivedAt && !ver.archived_at">
                  <button v-if="canSetCurrentVersion" class="btn-secondary btn-sm" @click="switchCurrentVersion(ver)">设为当前版本</button>
                  <button v-if="canArchive" class="btn-ghost btn-sm" @click="archiveVer(ver)">归档</button>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { XIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { KNOWLEDGE_DOCUMENT_STATUS_LABELS } from '@/common/constants'
import type { DocumentTaskItem, KnowledgeDocumentDetail, KnowledgeChunk } from '@/types'

const props = defineProps<{
  open: boolean
  doc: KnowledgeDocumentDetail | null
  canUpload: boolean
  canSetCurrentVersion: boolean
  canArchive: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'updated'): void
}>()

const kbApi = useKnowledgeBase()

const activeDetailTab = ref('info')
const detailTabs = [
  { key: 'info', label: '基本信息与治理' },
  { key: 'tasks', label: '处理任务' },
  { key: 'markdown', label: 'Markdown 预览' },
  { key: 'assets', label: '多模态资产' },
  { key: 'chunks', label: '切片管理' },
  { key: 'history', label: '版本历史' },
]

const chunks = ref<KnowledgeChunk[]>([])
const chunksLoading = ref(false)
const docMarkdown = ref('')
const markdownLoading = ref(false)
const docAssets = ref<any[]>([])
const assetsLoading = ref(false)
const docVersions = ref<KnowledgeDocumentDetail[]>([])
const versionsLoading = ref(false)
const docTasks = ref<DocumentTaskItem[]>([])
const tasksLoading = ref(false)

// 安全治理表单状态
const govForm = reactive({
  visibility: 'company' as 'company' | 'department' | 'private',
  securityLevel: 0,
  department: '',
  tags: '',
  businessCategory: '',
  expiresAt: '',
})
const govSaving = ref(false)

// 版本上传状态
const versionFile = ref<File | null>(null)
const versionUploading = ref(false)

// 深度监听文档切换
watch(
  () => props.doc,
  (newDoc) => {
    if (newDoc) {
      activeDetailTab.value = 'info'
      govForm.visibility = newDoc.visibility || 'company'
      govForm.securityLevel = newDoc.securityLevel ?? 0
      govForm.department = newDoc.department ?? ''
      govForm.tags = Array.isArray(newDoc.tags) ? newDoc.tags.join(',') : (newDoc.tags ?? '')
      govForm.businessCategory = newDoc.businessCategory ?? newDoc.business_category ?? ''
      govForm.expiresAt = dateInputValue(newDoc.expiresAt || newDoc.expires_at)
    }
  },
  { immediate: true }
)

async function switchDetailTab(key: string) {
  activeDetailTab.value = key
  const document = props.doc
  const kbId = document?.knowledgeBaseId || document?.knowledge_base_id
  if (!document || !kbId) return

  if (key === 'tasks') {
    tasksLoading.value = true
    try {
      docTasks.value = await kbApi.listDocumentTasks(document.id)
    } finally {
      tasksLoading.value = false
    }
  } else if (key === 'chunks') {
    chunksLoading.value = true
    try {
      chunks.value = await kbApi.listChunks(kbId, document.id)
    } finally {
      chunksLoading.value = false
    }
  } else if (key === 'markdown') {
    markdownLoading.value = true
    try {
      const res = await kbApi.getDocumentMarkdown(kbId, document.id)
      docMarkdown.value = res?.markdown ?? ''
    } finally {
      markdownLoading.value = false
    }
  } else if (key === 'assets') {
    assetsLoading.value = true
    try {
      docAssets.value = await kbApi.listDocumentAssets(kbId, document.id)
    } finally {
      assetsLoading.value = false
    }
  } else if (key === 'history') {
    versionsLoading.value = true
    try {
      docVersions.value = await kbApi.listDocumentVersions(kbId, document.id)
    } finally {
      versionsLoading.value = false
    }
  }
}

async function toggleChunk(c: KnowledgeChunk) {
  const kbId = props.doc?.knowledgeBaseId || props.doc?.knowledge_base_id
  if (!kbId) return
  const next = !c.enabled
  const ok = await kbApi.setChunkEnabled(kbId, c.id, next)
  if (ok) {
    c.enabled = next
  }
}

async function saveGovernance() {
  const document = props.doc
  const kbId = document?.knowledgeBaseId || document?.knowledge_base_id
  if (!document || !kbId) return
  govSaving.value = true
  try {
    const updated = await kbApi.updateDocumentGovernance(kbId, document.id, {
      visibility: govForm.visibility,
      securityLevel: govForm.securityLevel,
      department: govForm.department,
      tags: govForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      businessCategory: govForm.businessCategory,
      expiresAt: govForm.expiresAt || undefined,
    })
    if (updated) {
      alert('安全治理设置更新成功！')
      emit('updated')
    }
  } finally {
    govSaving.value = false
  }
}

function onVersionFileSelected(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    versionFile.value = file
  }
}

async function submitVersionUpload() {
  const document = props.doc
  const kbId = document?.knowledgeBaseId || document?.knowledge_base_id
  if (!document || !kbId || !versionFile.value) return
  versionUploading.value = true
  try {
    const res = await kbApi.uploadDocumentVersion(kbId, document.id, versionFile.value)
    if (res) {
      alert('新版本上传完成，正在后台重新切分与建图！')
      versionFile.value = null
      await switchDetailTab('history')
      emit('updated')
    }
  } finally {
    versionUploading.value = false
  }
}

async function switchCurrentVersion(ver: KnowledgeDocumentDetail) {
  const document = props.doc
  const kbId = document?.knowledgeBaseId || document?.knowledge_base_id
  if (!document || !kbId) return
  const res = await kbApi.setCurrentDocumentVersion(kbId, ver.id)
  if (res) {
    alert(`已切换当前版本为 v${ver.version ?? 1}`)
    await switchDetailTab('history')
    emit('updated')
  }
}

async function archiveVer(ver: KnowledgeDocumentDetail) {
  const document = props.doc
  const kbId = document?.knowledgeBaseId || document?.knowledge_base_id
  if (!document || !kbId) return
  if (!confirm(`确定归档版本 v${ver.version ?? 1} 吗？`)) return
  const res = await kbApi.archiveDocument(kbId, ver.id)
  if (res) {
    alert(`版本 v${ver.version ?? 1} 已成功归档。`)
    await switchDetailTab('history')
    emit('updated')
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

function dateInputValue(val?: string | null) {
  if (!val) return ''
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDuration(start?: string | null, end?: string | null) {
  if (!start || !end) return '未完成'
  const started = new Date(start).getTime()
  const finished = new Date(end).getTime()
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return '-'
  const seconds = Math.round((finished - started) / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatTime(ms?: number | null): string {
  if (ms == null) return '00:00'
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function assetUrl(asset: any): string {
  return asset.url || asset.storageUrl || asset.storage_url || ''
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

function stepStatusClassOf(status?: string): string {
  if (status === 'completed') return 'step-dot--success'
  if (status === 'failed') return 'step-dot--error'
  if (status === 'running' || status === 'pending') return 'step-dot--warning'
  return 'step-dot--secondary'
}

function visibilityLabelOf(visibility?: string): string {
  if (visibility === 'private') return '仅作者'
  if (visibility === 'department') return '本部门'
  return '全公司'
}

function taskTypeLabelOf(type?: string): string {
  if (type === 'upload_ingest') return '上传入库'
  return type || '文档处理'
}

function taskStepLabelOf(step?: string): string {
  const labels: Record<string, string> = {
    parse: '解析文件',
    index: '写入索引',
    graph_sync: '同步图谱',
  }
  return labels[step || ''] ?? step ?? '-'
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
/* 抽屉浮层 */
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.3);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}

.drawer {
  width: 500px;
  max-width: 100%;
  height: 100%;
  background: #fff;
  box-shadow: -10px 0 40px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  animation: slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.drawer--large {
  width: 720px;
}

@keyframes slide-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.drawer-head {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.drawer-title-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  text-align: left;
}

.drawer-title-stack h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.drawer-subtitle {
  margin: 2px 0 0;
  font-size: 11.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 480px;
}

.drawer-close {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
}

.drawer-tabs {
  display: flex;
  gap: 4px;
  padding: 0 16px;
  background: #f8fafc;
  border-bottom: 1px solid var(--border);
}

.tab-btn {
  padding: 12px 14px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}

.tab-btn:hover {
  color: var(--primary);
}

.tab-btn--active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Tab 1: Info & Governance */
.detail-info-pane {
  display: flex;
  flex-direction: column;
  gap: 20px;
  text-align: left;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  background: #f8fafc;
  padding: 16px;
  border-radius: 8px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-item .lbl {
  font-size: 11.5px;
  color: var(--text-muted);
}

.info-item .val {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
}

.font-mono {
  font-family: monospace;
}

.section-divider {
  font-size: 11px;
  font-weight: 800;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 6px;
}

.gov-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

select, input[type="text"] {
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  font-size: 13px;
}

input[type="date"] {
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  font-size: 13px;
}

select:focus, input[type="text"]:focus, input[type="date"]:focus {
  border-color: var(--primary);
}

.btn-primary {
  height: 38px;
  background: var(--primary-gradient, linear-gradient(135deg, #3b82f6, #2563eb));
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  align-self: flex-start;
  padding: 0 20px;
}

.btn-primary:disabled {
  opacity: 0.6;
}

.asset-overview-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  background: #f8fafc;
}

.asset-overview-strip article {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  background: #fff;
}

.asset-overview-strip span {
  color: var(--text-muted);
  font-size: 10.5px;
  font-weight: 800;
}

.asset-overview-strip strong {
  color: var(--text);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-tasks-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  text-align: left;
}

.task-timeline {
  display: flex;
  flex-direction: column;
  gap: 14px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.task-record {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
}

.task-record__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.task-record__head div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.task-record__head strong {
  color: var(--text);
  font-size: 13px;
}

.task-record__head span:not(.status-indicator-pill) {
  color: var(--text-muted);
  font-family: monospace;
  font-size: 10.5px;
}

.task-record__meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
  color: var(--text-muted);
  font-size: 11.5px;
}

.task-record__error,
.task-step-inline-list p {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 11.5px;
}

.task-step-inline-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.task-step-inline-list li {
  display: grid;
  grid-template-columns: 12px 1fr auto auto;
  gap: 8px;
  align-items: center;
  color: var(--text-secondary);
  font-size: 11.5px;
}

.task-step-inline-list li p {
  grid-column: 2 / -1;
}

.task-step-inline-list small,
.task-step-inline-list em {
  color: var(--text-muted);
  font-style: normal;
  font-size: 10.5px;
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.step-dot--success { background: #10b981; }
.step-dot--warning { background: #f59e0b; }
.step-dot--error { background: #ef4444; }
.step-dot--secondary { background: #94a3b8; }

/* Tab 2: Markdown Preview */
.detail-markdown-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.markdown-preview-box {
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  flex: 1;
  text-align: left;
  overflow: auto;
}

.md-raw {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

/* Tab 3: Multimodal Assets */
.assets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.asset-detail-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.asset-detail-card .header {
  padding: 10px 14px;
  background: #f8fafc;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
}

.asset-detail-card .badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 700;
}

.badge--image { background: #e0f2fe; color: #0369a1; }
.badge--video { background: #f3e8ff; color: #6b21a8; }
.badge--audio { background: #ccfbf1; color: #0f766e; }

.asset-detail-card .body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.image-box, .video-box {
  background: #fafafa;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 160px;
  border: 1px solid rgba(226, 232, 240, 0.4);
}

.asset-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.asset-fallback {
  color: var(--text-muted);
  font-size: 12px;
}

.video-box {
  position: relative;
}

.mini-video-player {
  width: 100%;
  max-height: 160px;
  border-radius: 8px;
}

.asset-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.asset-meta span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time-tag {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(15, 23, 42, 0.85);
  color: #fff;
  font-size: 9.5px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.mini-audio-player {
  width: 100%;
}

.caption-text {
  font-size: 11.5px;
  text-align: left;
}

.caption-text p {
  margin: 3px 0 0;
  color: var(--text-secondary);
}

/* Tab 4: Chunks list */
.chunk-card-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chunk-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 12px);
  padding: 16px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: opacity 0.2s ease;
}

.chunk-card--disabled {
  opacity: 0.6;
}

.chunk-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chunk-idx {
  font-size: 13px;
  font-weight: 750;
  color: var(--primary);
}

.chunk-char {
  font-size: 11.5px;
  color: var(--text-muted);
}

.toggle-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  cursor: pointer;
}

.chunk-card__body {
  margin: 0;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  background: #f8fafc;
  padding: 12px;
  border-radius: 6px;
  text-align: left;
}

/* Tab 5: Version History */
.detail-history-pane {
  display: flex;
  flex-direction: column;
  gap: 20px;
  text-align: left;
}

.history-upload-section {
  background: #f8fafc;
  padding: 16px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-upload-section h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 750;
  color: var(--text);
}

.version-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.version-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.version-item.is-current {
  border-color: rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.02);
}

.v-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.v-header strong {
  font-size: 13.5px;
  color: var(--text);
}

.current-badge {
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 9.5px;
  font-weight: 750;
  padding: 2px 6px;
  border-radius: 4px;
}

.archived-badge {
  background: #f1f5f9;
  color: #64748b;
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
}

.v-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.v-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.btn-secondary {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}

.btn-secondary:hover {
  background: #fafafa;
}

.btn-ghost {
  border: none;
  background: transparent;
  color: var(--primary);
  font-weight: 700;
  cursor: pointer;
  font-size: 12px;
}

.btn-ghost:hover {
  text-decoration: underline;
}

.btn-secondary.btn-sm, .btn-ghost.btn-sm {
  padding: 4px 8px;
  font-size: 11px;
}

/* Loaders and placeholders */
.loader-box, .empty-box {
  padding: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-muted);
  font-size: 13px;
  background: #fafafa;
  border-radius: 8px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2.5px solid rgba(59, 130, 246, 0.2);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.status-indicator-pill {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
}

.pill--success { background: #ecfdf5; color: #059669; }
.pill--warning { background: #fffbeb; color: #d97706; }
.pill--error { background: #fef2f2; color: #dc2626; }
.pill--secondary { background: #f1f5f9; color: #475569; }
</style>
