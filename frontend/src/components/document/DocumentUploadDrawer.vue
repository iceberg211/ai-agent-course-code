<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @click.self="$emit('close')">
      <div class="drawer drawer--right">
        <header class="drawer-head">
          <h3>文档上传中心</h3>
          <button class="drawer-close" type="button" @click="$emit('close')">
            <XIcon :size="16" />
          </button>
        </header>

        <form class="drawer-body upload-form" @submit.prevent="submitUpload">
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
                multiple
                accept=".txt,.md,.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.mp3,.mp4"
                required
                @change="onFileSelected"
              />
              <div class="file-picker__dropzone" @click="triggerFileInput">
                <UploadCloudIcon :size="24" class="picker-icon" />
                <span v-if="selectedFiles.length === 1">{{ selectedFiles[0].name }} ({{ formatSize(selectedFiles[0].size) }})</span>
                <span v-else-if="selectedFiles.length > 1">已选择 {{ selectedFiles.length }} 个文件</span>
                <span v-else>支持文本、Office、网页、音视频或图片文件</span>
              </div>
            </div>
          </div>

          <!-- 数据隔离治理属性 -->
          <div class="section-divider">安全与数据治理</div>

          <div class="field-row">
            <div class="field">
              <label class="label">可见范围</label>
              <select v-model="uploadMetadata.visibility">
                <option value="company">全公司可见 (Company)</option>
                <option value="department">本部门可见 (Department)</option>
                <option value="private">仅创建者可见 (Private)</option>
              </select>
            </div>

            <div class="field">
              <label class="label">安全级别 (SecurityLevel)</label>
              <select v-model.number="uploadMetadata.securityLevel">
                <option :value="0">公开 (Level 0)</option>
                <option :value="1">内部敏感 (Level 1)</option>
                <option :value="2">核心极密 (Level 2)</option>
              </select>
            </div>
          </div>

          <div class="field">
            <label class="label">所属部门</label>
            <input type="text" v-model="uploadMetadata.department" placeholder="示例: R&D, HR" />
          </div>

          <div class="field">
            <label class="label">标签 (用英文逗号分隔)</label>
            <input type="text" v-model="tagString" placeholder="示例: 财务, 会计准则, 2026" />
          </div>

          <div class="field">
            <label class="label">业务分类 (Category)</label>
            <input type="text" v-model="uploadMetadata.category" placeholder="示例: 业务规范, 合同文本" />
          </div>

          <p v-if="uploadError" class="field-error">{{ uploadError }}</p>

          <!-- 任务上传队列进度监控 -->
          <div v-if="uploadQueue.length" class="upload-queue">
            <article v-for="item in uploadQueue" :key="item.localId" class="upload-queue-item">
              <div>
                <strong>{{ item.filename }}</strong>
                <span>{{ item.stageLabel }} · {{ item.progress }}%</span>
              </div>
              <div class="upload-queue-item__tail">
                <button
                  v-if="item.taskId"
                  class="btn-ghost btn-sm"
                  type="button"
                  @click="$emit('inspect-task', item.taskId)"
                >
                  详情
                </button>
                <span class="status-indicator-pill" :class="statusClassOf(item.status)">
                  {{ statusLabelOf(item.status) }}
                </span>
              </div>
            </article>
          </div>

          <footer class="drawer-foot">
            <button class="btn-cancel" type="button" @click="$emit('close')">取消</button>
            <button
              class="btn-submit"
              type="submit"
              :disabled="kbApi.uploading.value || !uploadTargetKbId || selectedFiles.length === 0"
            >
              {{ kbApi.uploading.value ? '后台解析并构建图谱中…' : '开始导入' }}
            </button>
          </footer>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { UploadCloudIcon, XIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { KNOWLEDGE_DOCUMENT_STATUS_LABELS } from '@/common/constants'
import type { KnowledgeBase, DocumentTaskItem } from '@/types'

const props = defineProps<{
  open: boolean
  kbs: KnowledgeBase[]
  defaultKbId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'uploaded'): void
  (e: 'inspect-task', taskId: string): void
}>()

const kbApi = useKnowledgeBase()

const uploadTargetKbId = ref('')
const selectedFiles = ref<File[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const uploadError = ref('')
const tagString = ref('')

interface UploadQueueItem {
  localId: string
  filename: string
  taskId?: string
  status: string
  progress: number
  stageLabel: string
}
const uploadQueue = ref<UploadQueueItem[]>([])

const uploadMetadata = reactive({
  category: '',
  tags: [] as string[],
  department: '',
  visibility: 'private' as 'company' | 'department' | 'private',
  securityLevel: 0,
})

// 监听默认知识库设置
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      uploadTargetKbId.value = props.defaultKbId || ''
      selectedFiles.value = []
      uploadQueue.value = []
      uploadError.value = ''
      tagString.value = ''
      uploadMetadata.category = ''
      uploadMetadata.tags = []
      uploadMetadata.department = ''
      uploadMetadata.visibility = 'private'
      uploadMetadata.securityLevel = 0
    }
  }
)

function onFileSelected(e: Event) {
  const target = e.target as HTMLInputElement
  selectedFiles.value = Array.from(target.files ?? [])
}

function triggerFileInput() {
  fileInput.value?.click()
}

async function submitUpload() {
  if (!uploadTargetKbId.value || selectedFiles.value.length === 0) return
  uploadError.value = ''
  
  if (tagString.value.trim()) {
    uploadMetadata.tags = tagString.value.split(',').map((t) => t.trim()).filter(Boolean)
  }
  
  uploadQueue.value = selectedFiles.value.map((file, idx) => ({
    localId: `${Date.now()}-${idx}`,
    filename: file.name,
    status: 'pending',
    progress: 0,
    stageLabel: '等待上传',
  }))

  for (const [index, file] of selectedFiles.value.entries()) {
    const queueItem = uploadQueue.value[index]
    queueItem.status = 'running'
    queueItem.stageLabel = '上传中'
    try {
      const task = await kbApi.uploadDocumentTask(
        uploadTargetKbId.value,
        file,
        uploadMetadata,
        (percent) => {
          queueItem.progress = percent
        },
      )
      if (!task) {
        queueItem.status = 'failed'
        queueItem.stageLabel = '上传失败'
        uploadError.value = '部分文件上传失败，请查看队列状态。'
        continue
      }
      queueItem.taskId = task.id
      applyTaskToQueue(queueItem, task)
      void pollUploadTask(queueItem)
    } catch (err: any) {
      queueItem.status = 'failed'
      queueItem.stageLabel = '上传失败'
      uploadError.value = `上传失败：${err.message || '网络或权限错误'}`
    }
  }
  emit('uploaded')
}

function applyTaskToQueue(queueItem: UploadQueueItem, task: DocumentTaskItem) {
  queueItem.status = task.status
  queueItem.progress = task.progress ?? queueItem.progress
  queueItem.stageLabel = stageLabelOf(task.stage)
  if (task.error) queueItem.stageLabel = task.error
}

async function pollUploadTask(queueItem: UploadQueueItem) {
  if (!queueItem.taskId) return
  for (let i = 0; i < 30; i += 1) {
    if (queueItem.status === 'completed' || queueItem.status === 'failed') return
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const task = await kbApi.getDocumentTask(queueItem.taskId)
    if (task) {
      applyTaskToQueue(queueItem, task)
      if (task.status === 'completed') emit('uploaded')
    }
  }
}

// 格式化与显示助手
function formatSize(bytes?: number | null) {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
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
/* 继承主文件中的 CSS，确保样式一致 */
.modal-backdrop {
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

.drawer-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.drawer-close {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  text-align: left;
}

.drawer-foot {
  padding: 20px 24px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  background: #f8fafc;
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

.required {
  color: var(--error);
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

.file-picker {
  position: relative;
}

.file-picker input[type="file"] {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  z-index: 10;
}

.file-picker__dropzone {
  border: 1.5px dashed var(--border);
  border-radius: 10px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #fafafa;
  transition: all 0.2s ease;
}

.file-picker:hover .file-picker__dropzone {
  border-color: var(--primary);
  background: rgba(59, 130, 246, 0.02);
}

.picker-icon {
  color: var(--text-muted);
}

.section-divider {
  margin-top: 10px;
  font-size: 11px;
  font-weight: 800;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 6px;
}

.field-error {
  margin: 0;
  font-size: 12px;
  color: var(--error);
}

.upload-queue {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.upload-queue-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(226, 232, 240, 0.5);
  border-radius: 8px;
}

.upload-queue-item div:first-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.upload-queue-item strong {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-queue-item span {
  font-size: 11px;
  color: var(--text-muted);
}

.upload-queue-item__tail {
  display: flex;
  align-items: center;
  gap: 10px;
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

.btn-ghost {
  border: none;
  background: transparent;
  color: var(--primary);
  font-weight: 700;
  cursor: pointer;
}

.btn-ghost.btn-sm {
  font-size: 11.5px;
}

.btn-cancel {
  height: 38px;
  padding: 0 16px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
}

.btn-submit {
  height: 38px;
  padding: 0 20px;
  border: none;
  background: var(--primary-gradient, linear-gradient(135deg, #3b82f6, #2563eb));
  color: #fff;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-btn);
}

.btn-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
