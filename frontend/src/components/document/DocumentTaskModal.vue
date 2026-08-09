<template>
  <Teleport to="body">
    <div v-if="open" class="drawer-backdrop" @click.self="$emit('close')">
      <aside class="drawer drawer--right">
        <header class="drawer-head">
          <div class="drawer-title-stack">
            <h3>处理任务详情</h3>
            <p class="drawer-subtitle" :title="activeTask?.id">{{ activeTask?.id || '正在加载任务信息' }}</p>
          </div>
          <button class="drawer-close" type="button" @click="$emit('close')">
            <XIcon :size="16" />
          </button>
        </header>

        <div class="drawer-body task-detail-body">
          <div v-if="taskDetailLoading" class="loader-box">
            <div class="spinner"></div>
            <p>正在读取处理步骤…</p>
          </div>
          <template v-else-if="activeTask">
            <div class="task-summary-grid">
              <div class="info-item">
                <span class="lbl">任务状态</span>
                <span class="val">{{ statusLabelOf(activeTask.status) }}</span>
              </div>
              <div class="info-item">
                <span class="lbl">当前阶段</span>
                <span class="val">{{ stageLabelOf(activeTask.stage) }}</span>
              </div>
              <div class="info-item">
                <span class="lbl">进度</span>
                <span class="val">{{ activeTask.progress ?? 0 }}%</span>
              </div>
              <div class="info-item">
                <span class="lbl">开始时间</span>
                <span class="val">{{ formatDateTime(activeTask.startedAt || activeTask.started_at || activeTask.createdAt || activeTask.created_at) }}</span>
              </div>
              <div class="info-item">
                <span class="lbl">结束时间</span>
                <span class="val">{{ formatDateTime(activeTask.finishedAt || activeTask.finished_at) }}</span>
              </div>
            </div>

            <div v-if="activeTask.error" class="task-error">
              {{ activeTask.error }}
            </div>

            <ol class="task-step-list">
              <li v-for="step in activeTask.steps ?? []" :key="step.step" class="task-step">
                <div class="task-step__head">
                  <strong>{{ taskStepLabelOf(step.step) }}</strong>
                  <span class="status-indicator-pill" :class="statusClassOf(step.status)">{{ statusLabelOf(step.status) }}</span>
                </div>
                <div class="task-step__meta">
                  <span>开始：{{ formatDateTime(step.startedAt || step.started_at) }}</span>
                  <span>结束：{{ formatDateTime(step.finishedAt || step.finished_at) }}</span>
                </div>
                <p v-if="step.error" class="task-step__error">{{ step.error }}</p>
              </li>
            </ol>
          </template>
          <div v-else class="empty-box">
            <p>没有找到处理任务</p>
          </div>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { XIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { KNOWLEDGE_DOCUMENT_STATUS_LABELS } from '@/common/constants'
import type { DocumentTaskItem, KnowledgeDocumentDetail } from '@/types'

const props = defineProps<{
  open: boolean
  doc: KnowledgeDocumentDetail | null
  taskId: string | null
}>()

defineEmits<{
  (e: 'close'): void
}>()

const kbApi = useKnowledgeBase()

const activeTask = ref<DocumentTaskItem | null>(null)
const taskDetailLoading = ref(false)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void loadTask()
    }
  }
)

watch(
  () => props.taskId,
  () => {
    if (props.open) {
      void loadTask()
    }
  }
)

async function loadTask() {
  taskDetailLoading.value = true
  activeTask.value = null
  try {
    if (props.taskId) {
      activeTask.value = await kbApi.getDocumentTask(props.taskId)
    } else if (props.doc) {
      const tasks = await kbApi.listDocumentTasks(props.doc.id)
      activeTask.value = tasks[0] ?? null
    }
  } finally {
    taskDetailLoading.value = false
  }
}

// 辅助格式化函数
function formatDateTime(val?: string) {
  if (!val) return '-'
  const d = new Date(val)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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

function taskStepLabelOf(step?: string): string {
  const labels: Record<string, string> = {
    parse: '解析文件',
    index: '写入索引',
    graph_sync: '同步图谱',
  }
  return labels[step || ''] ?? step ?? '-'
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
  max-width: 400px;
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
  gap: 20px;
}

/* Task details */
.task-summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  background: #f8fafc;
  padding: 16px;
  border-radius: 8px;
  text-align: left;
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

.task-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
  text-align: left;
}

.task-step-list {
  padding: 0;
  margin: 10px 0 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.task-step {
  border-left: 2px solid var(--border);
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}

.task-step__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.task-step__head strong {
  font-size: 13px;
  color: var(--text-secondary);
}

.task-step__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted);
}

.task-step__error {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: var(--error);
  background: rgba(239, 68, 68, 0.04);
  border: 1px dashed rgba(239, 68, 68, 0.2);
  padding: 6px;
  border-radius: 4px;
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
</style>
