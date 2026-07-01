<template>
  <main class="evaluation-view">
    <header class="page-head">
      <div>
        <h2>评估验证</h2>
        <p class="subtitle">评测多路检索召回率与大模型作答忠实度，确保知识回答可信度</p>
      </div>
      <div class="head-actions">
        <select v-model="selectedKbId" class="select-kb" @change="loadEvalCases">
          <option value="" disabled>选择要评估的知识库</option>
          <option v-for="kb in kbs" :key="kb.id" :value="kb.id">{{ kb.name }}</option>
        </select>
        <button class="btn-primary" :disabled="running || !selectedKbId" @click="runEvaluation">
          <PlayIcon :size="15" :class="{ 'spin': running }" />
          {{ running ? '批量评测运行中…' : '运行批量评测' }}
        </button>
      </div>
    </header>

    <!-- 如果没有选择知识库 -->
    <div v-if="!selectedKbId" class="state-placeholder">
      <ShieldCheckIcon :size="48" class="placeholder-icon" />
      <h3>请选择目标知识库</h3>
      <p>选择一个知识库以查看其对应的黄金测试集（Golden Dataset）与最近运行 of 召回评估统计</p>
    </div>

    <!-- 评估内容区 -->
    <div v-else class="eval-layout">
      <!-- 顶部汇总看板 -->
      <section class="metrics-dashboard">
        <div class="metric-card">
          <span class="label">测试用例总数</span>
          <span class="value">{{ cases.length }}</span>
          <span class="desc">黄金评测数据集</span>
        </div>
        <div class="metric-card highlight-green">
          <span class="label">平均检索命中率 (Hit Rate)</span>
          <span class="value">{{ formatPercent(avgHitRate) }}</span>
          <span class="desc">Top-K 覆盖黄金文档率</span>
        </div>
        <div class="metric-card highlight-blue">
          <span class="label">黄金召回率 (Golden Recall)</span>
          <span class="value">{{ formatPercent(avgRecall) }}</span>
          <span class="desc">语义重排最终覆盖率</span>
        </div>
        <div class="metric-card" :class="passRateClass">
          <span class="label">人工验证通过率</span>
          <span class="value">{{ formatPercent(verifiedPassRate) }}</span>
          <span class="desc">黄金测试审核通过</span>
        </div>
      </section>

      <!-- 核心表格区 -->
      <section class="list-section">
        <div class="section-head">
          <h3>测试用例列表 ({{ cases.length }})</h3>
          <button class="btn-secondary btn-sm" @click="openCreateModal">
            <PlusIcon :size="13" /> 添加测试用例
          </button>
        </div>

        <div v-if="loading" class="loading-box">
          <div class="spinner"></div>
          <p>加载评测清单中…</p>
        </div>
        <div v-else-if="cases.length === 0" class="empty-box">
          <p>该知识库暂未创建测试用例</p>
          <button class="btn-ghost" @click="openCreateModal">创建首条黄金测试用例</button>
        </div>
        <div v-else class="table-container">
          <table class="eval-table">
            <thead>
              <tr>
                <th scope="col">黄金问题 (Question)</th>
                <th scope="col">预期答案/参考依据</th>
                <th scope="col">上次评测答案</th>
                <th scope="col">检索命中率</th>
                <th scope="col">LLM 评分</th>
                <th scope="col">审核状态</th>
                <th scope="col" class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in cases" :key="item.id">
                <td class="cell-question">
                  <strong>{{ item.question }}</strong>
                </td>
                <td class="cell-pre text-muted">{{ item.expectedAnswer || '未提供黄金参考' }}</td>
                <td class="cell-pre">{{ resolveActualAnswer(item) || '暂无运行记录' }}</td>
                <td>
                  <span class="score-badge" :class="scoreClass(resolveHitRate(item))">
                    {{ formatPercent(resolveHitRate(item)) }}
                  </span>
                </td>
                <td>
                  <span class="score-badge" :class="scoreClass(resolveRecall(item))">
                    {{ formatPercent(resolveRecall(item)) }}
                  </span>
                </td>
                <td>
                  <span class="status-pill" :class="reviewClass(resolveReviewStatus(item))">
                    {{ reviewLabel(resolveReviewStatus(item)) }}
                  </span>
                </td>
                <td class="text-right cell-actions">
                  <button class="action-btn" title="立即运行此例" :disabled="running" @click="runSingleCase(item)">
                    <PlayIcon :size="13" />
                  </button>
                  <button class="action-btn" title="通过审核" @click="reviewCase(item, 'passed')">
                    <CheckIcon :size="13" />
                  </button>
                  <button class="action-btn action-btn--danger" title="驳回/不通过" @click="reviewCase(item, 'failed')">
                    <XIcon :size="13" />
                  </button>
                  <button class="action-btn action-btn--danger" title="删除" @click="deleteCase(item)">
                    <Trash2Icon :size="13" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <!-- 创建 Modal -->
    <Teleport to="body">
      <div v-if="createOpen" class="modal-backdrop" @click.self="createOpen = false">
        <div class="modal">
          <header class="modal-head">
            <h3>添加黄金测试用例</h3>
            <button class="modal-close" @click="createOpen = false">
              <XIcon :size="16" />
            </button>
          </header>
          <form class="modal-body" @submit.prevent="submitCreate">
            <div class="field">
              <label class="label">黄金测试提问 <span class="required">*</span></label>
              <textarea v-model="form.question" rows="3" placeholder="输入用户真实可能提问的典型 query…" required></textarea>
            </div>
            <div class="field">
              <label class="label">标准黄金答案 / 评测依据文段</label>
              <textarea v-model="form.expectedAnswer" rows="4" placeholder="大模型作答评测将以本段作为真值（Ground Truth）参考…"></textarea>
            </div>
            <footer class="modal-foot">
              <button class="btn-cancel" type="button" @click="createOpen = false">取消</button>
              <button class="btn-submit" type="submit" :disabled="submitting">添加</button>
            </footer>
          </form>
        </div>
      </div>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  PlayIcon,
  PlusIcon,
  CheckIcon,
  XIcon,
  Trash2Icon,
  ShieldCheckIcon,
} from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import type { KnowledgeBase, KnowledgeEvalCase } from '@/types'

const kbApi = useKnowledgeBase()
const route = useRoute()
const kbs = ref<KnowledgeBase[]>([])
const selectedKbId = ref('')
const cases = ref<KnowledgeEvalCase[]>([])
const loading = ref(false)
const running = ref(false)
const createOpen = ref(false)
const submitting = ref(false)

const form = ref({
  question: '',
  expectedAnswer: '',
})

// 计算汇总数据
const avgHitRate = computed(() => {
  if (cases.value.length === 0) return 0
  const sum = cases.value.reduce((acc, c) => acc + (resolveHitRate(c) ?? 0), 0)
  return sum / cases.value.length
})

const avgRecall = computed(() => {
  if (cases.value.length === 0) return 0
  const sum = cases.value.reduce((acc, c) => acc + (resolveRecall(c) ?? 0), 0)
  return sum / cases.value.length
})

const verifiedPassRate = computed(() => {
  if (cases.value.length === 0) return 0
  const passed = cases.value.filter((c) => resolveReviewStatus(c) === 'passed').length
  return passed / cases.value.length
})

const passRateClass = computed(() => {
  const rate = verifiedPassRate.value
  if (rate >= 0.8) return 'highlight-green'
  if (rate >= 0.5) return 'highlight-blue'
  return 'highlight-red'
})

onMounted(async () => {
  const list = await kbApi.listAll()
  kbs.value = list
  const routeKbId = typeof route.query.knowledgeBaseId === 'string' ? route.query.knowledgeBaseId : ''
  if (list.length > 0) {
    selectedKbId.value = list.some((kb) => kb.id === routeKbId) ? routeKbId : list[0].id
    void loadEvalCases()
  }
})

async function loadEvalCases() {
  if (!selectedKbId.value) return
  loading.value = true
  try {
    cases.value = await kbApi.listEvalCases(selectedKbId.value)
  } finally {
    loading.value = false
  }
}

async function runEvaluation() {
  if (!selectedKbId.value || running.value) return
  running.value = true
  try {
    cases.value = await kbApi.runEvalBatch(selectedKbId.value)
    alert('批量黄金测试集评估完成！')
  } catch (err) {
    alert('评测失败：' + (err instanceof Error ? err.message : String(err)))
  } finally {
    running.value = false
  }
}

async function runSingleCase(item: KnowledgeEvalCase) {
  if (running.value) return
  running.value = true
  try {
    const updated = await kbApi.runEvalCase(selectedKbId.value, item.id)
    if (updated) {
      const idx = cases.value.findIndex((c) => c.id === item.id)
      if (idx !== -1) cases.value[idx] = updated
    }
  } finally {
    running.value = false
  }
}

async function reviewCase(item: KnowledgeEvalCase, status: 'passed' | 'failed' | 'unreviewed') {
  const updated = await kbApi.updateEvalReview(selectedKbId.value, item.id, status)
  if (updated) {
    const idx = cases.value.findIndex((c) => c.id === item.id)
    if (idx !== -1) cases.value[idx] = updated
  }
}

async function deleteCase(item: KnowledgeEvalCase) {
  if (!confirm('确定删除此条黄金测试例吗？')) return
  const deleted = await kbApi.deleteEvalCase(selectedKbId.value, item.id)
  if (deleted) {
    cases.value = cases.value.filter((c) => c.id !== item.id)
  }
}

function openCreateModal() {
  form.value.question = ''
  form.value.expectedAnswer = ''
  createOpen.value = true
}

async function submitCreate() {
  if (!form.value.question.trim()) return
  submitting.value = true
  try {
    const created = await kbApi.createEvalCase(selectedKbId.value, form.value)
    if (created) {
      cases.value.push(created)
      createOpen.value = false
    }
  } finally {
    submitting.value = false
  }
}

// 辅助方法
function formatPercent(value?: number): string {
  if (value === undefined || value === null) return '0%'
  return `${Math.round(value * 100)}%`
}

function scoreClass(val?: number) {
  if (val === undefined || val === null) return 'score-low'
  if (val >= 0.8) return 'score-high'
  if (val >= 0.5) return 'score-mid'
  return 'score-low'
}

function reviewLabel(status?: string) {
  const labels: Record<string, string> = {
    passed: '已通过',
    failed: '不通过',
    unreviewed: '待审核',
  }
  return labels[status ?? ''] ?? '待审核'
}

function reviewClass(status?: string) {
  return `review--${status ?? 'unreviewed'}`
}

function resolveActualAnswer(item: KnowledgeEvalCase): string {
  return item.lastRunActualAnswer ?? item.last_run_actual_answer ?? ''
}

function resolveHitRate(item: KnowledgeEvalCase): number | null {
  return item.lastRunHitRate ?? item.last_run_hit_rate ?? null
}

function resolveRecall(item: KnowledgeEvalCase): number | null {
  return item.lastRunRecall ?? item.last_run_recall ?? null
}

function resolveReviewStatus(item: KnowledgeEvalCase): string {
  return item.userReviewStatus ?? item.user_review_status ?? 'unreviewed'
}
</script>

<style scoped>
.evaluation-view {
  padding: 24px;
  height: 100%;
  overflow-y: auto;
  background: var(--bg-surface);
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.head-actions {
  display: flex;
  gap: 12px;
}

.select-kb {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
  background: #fff;
}

.eval-layout {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.metrics-dashboard {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.metric-card {
  padding: 20px;
  border-radius: var(--radius-lg);
  background: #fff;
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-card .label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 600;
}

.metric-card .value {
  font-size: 28px;
  font-weight: 800;
  color: var(--text);
}

.metric-card .desc {
  font-size: 11px;
  color: var(--text-secondary);
}

.highlight-green {
  border-color: rgba(16, 185, 129, 0.28);
  background: rgba(16, 185, 129, 0.03);
}
.highlight-green .value {
  color: var(--success);
}

.highlight-blue {
  border-color: rgba(59, 130, 246, 0.28);
  background: rgba(59, 130, 246, 0.03);
}
.highlight-blue .value {
  color: var(--primary);
}

.highlight-red {
  border-color: rgba(239, 68, 68, 0.28);
  background: rgba(239, 68, 68, 0.03);
}
.highlight-red .value {
  color: var(--error);
}

.list-section {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.table-container {
  overflow-x: auto;
}

.eval-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.eval-table th {
  padding: 12px;
  border-bottom: 2px solid var(--border-muted);
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.eval-table td {
  padding: 12px;
  border-bottom: 1px solid var(--border-muted);
  font-size: 13px;
  vertical-align: top;
}

.cell-question {
  max-width: 200px;
}

.cell-pre {
  max-width: 250px;
  white-space: pre-wrap;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

.score-badge {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.score-high {
  background: rgba(16, 185, 129, 0.1);
  color: var(--success);
}
.score-mid {
  background: rgba(245, 158, 11, 0.1);
  color: var(--warning);
}
.score-low {
  background: rgba(239, 68, 68, 0.1);
  color: var(--error);
}

.status-pill {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
}

.review--passed {
  background: #d1fae5;
  color: #065f46;
}
.review--failed {
  background: #fee2e2;
  color: #991b1b;
}
.review--unreviewed {
  background: #f3f4f6;
  color: #374151;
}

.cell-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.loading-box,
.empty-box,
.state-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  text-align: center;
  color: var(--text-muted);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.placeholder-icon {
  margin-bottom: 16px;
  color: var(--text-muted);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
