<template>
  <main class="p-6 h-full overflow-y-auto bg-transparent text-left flex flex-col gap-6 w-full box-border">
    <PageHeader
      eyebrow="质量运营"
      title="评估验证"
      description="管理评估集、批量运行检索验证、审核失败用例并沉淀回归案例。"
    >
      <template #actions>
        <div class="flex items-center gap-3">
        <select v-model="selectedKbId" class="h-10 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary" @change="loadEvalCases">
          <option value="" disabled>选择要评估的知识库</option>
          <option v-for="kb in kbs" :key="kb.id" :value="kb.id">{{ kb.name }}</option>
        </select>
        <button class="inline-flex items-center gap-1.5 px-4.5 py-2.5 bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none rounded-lg text-[12.5px] font-bold cursor-pointer shadow-btn transition-all duration-200 hover:brightness-104 hover:-translate-y-[0.5px] disabled:opacity-60 disabled:cursor-not-allowed" :disabled="running || !selectedKbId" @click="runEvaluation">
          <PlayIcon :size="15" :class="{ 'animate-spin': running }" />
          <span>{{ running ? '批量评测运行中…' : '运行批量评测' }}</span>
        </button>
        </div>
      </template>
    </PageHeader>

    <!-- 如果没有选择知识库 -->
    <div v-if="!selectedKbId" class="flex flex-col items-center justify-center p-12 text-center text-text-muted bg-white/65 border border-white/50 rounded-xl gap-3">
      <ShieldCheckIcon :size="48" class="text-text-muted" />
      <h3 class="text-sm font-bold text-text-main m-0">请选择目标知识库</h3>
      <p class="text-xs text-text-muted">选择一个知识库以查看其对应的黄金测试集与最近运行统计</p>
    </div>

    <!-- 评估内容区 -->
    <div v-else class="flex flex-col gap-6">
      <!-- 顶部汇总看板 -->
      <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="p-5 rounded-xl bg-white border border-border-main flex flex-col gap-1 text-left">
          <span class="text-xs text-text-muted font-semibold">测试用例总数</span>
          <span class="text-[28px] font-black text-text-main leading-none">{{ cases.length }}</span>
          <span class="text-[11px] text-text-secondary mt-1">黄金评测数据集</span>
        </div>
        <div class="p-5 rounded-xl border flex flex-col gap-1 text-left border-emerald-500/28 bg-emerald-500/3">
          <span class="text-xs text-emerald-800 font-semibold">平均检索命中率 (Hit Rate)</span>
          <span class="text-[28px] font-black text-success leading-none">{{ formatPercent(avgHitRate) }}</span>
          <span class="text-[11px] text-emerald-700 mt-1">Top-K 黄金片段覆盖率</span>
        </div>
        <div class="p-5 rounded-xl border flex flex-col gap-1 text-left border-blue-500/28 bg-blue-500/3">
          <span class="text-xs text-blue-800 font-semibold">黄金召回率 (Golden Recall)</span>
          <span class="text-[28px] font-black text-primary leading-none">{{ formatPercent(avgRecall) }}</span>
          <span class="text-[11px] text-blue-700 mt-1">语义重排最终覆盖率</span>
        </div>
        <div class="p-5 rounded-xl border flex flex-col gap-1 text-left" :class="passRateClass === 'highlight-green' ? 'border-emerald-500/28 bg-emerald-500/3' : passRateClass === 'highlight-blue' ? 'border-blue-500/28 bg-blue-500/3' : 'border-red-500/28 bg-red-500/3'">
          <span class="text-xs font-semibold" :class="passRateClass === 'highlight-green' ? 'text-emerald-800' : passRateClass === 'highlight-blue' ? 'text-blue-800' : 'text-red-800'">人工验证通过率</span>
          <span class="text-[28px] font-black leading-none" :class="passRateClass === 'highlight-green' ? 'text-success' : passRateClass === 'highlight-blue' ? 'text-primary' : 'text-error'">{{ formatPercent(verifiedPassRate) }}</span>
          <span class="text-[11px] mt-1" :class="passRateClass === 'highlight-green' ? 'text-emerald-750' : passRateClass === 'highlight-blue' ? 'text-blue-750' : 'text-red-750'">黄金测试审核通过</span>
        </div>
      </section>

      <section class="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
        <div class="bg-white border border-border-main rounded-xl p-5 flex flex-col gap-4">
          <div class="flex justify-between items-start gap-4">
            <div>
              <h3 class="text-sm font-bold text-text-main m-0">失败分析与运行诊断</h3>
              <p class="text-xs text-text-muted m-0 mt-1">聚合最近一次评测结果，用于发现检索、重排和人工审核中的薄弱项。</p>
            </div>
            <button
              class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-border-main rounded-lg text-xs font-bold text-text-secondary cursor-pointer hover:bg-slate-50 hover:text-primary hover:border-primary-muted transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
              :disabled="failedCases.length === 0"
              @click="reviewFailedInSearch"
            >
              <SearchIcon :size="13" />
              <span>复查失败用例</span>
            </button>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div v-for="item in diagnosticCards" :key="item.label" class="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <span class="block text-[10.5px] font-bold text-text-muted">{{ item.label }}</span>
              <strong class="block text-xl font-black text-text-main mt-1">{{ item.value }}</strong>
              <span class="block text-[10.5px] text-text-muted mt-1">{{ item.hint }}</span>
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <article v-for="bucket in failureBuckets" :key="bucket.key" class="rounded-lg border border-slate-200 bg-white p-3">
              <div class="flex justify-between items-center gap-3">
                <h4 class="m-0 text-xs font-bold text-text-main">{{ bucket.label }}</h4>
                <span class="text-[11px] font-bold text-text-muted">{{ bucket.count }} 条</span>
              </div>
              <p class="m-0 mt-1 text-[11px] leading-relaxed text-text-muted">{{ bucket.description }}</p>
            </article>
          </div>
        </div>

        <aside class="bg-white border border-border-main rounded-xl p-5 flex flex-col gap-3">
          <h3 class="text-sm font-bold text-text-main m-0">待复查用例</h3>
          <p class="text-xs text-text-muted m-0">优先复查失败、低命中率或人工驳回的用例。</p>
          <div v-if="priorityReviewCases.length" class="flex flex-col gap-2">
            <button
              v-for="item in priorityReviewCases"
              :key="item.id"
              class="text-left border border-slate-200 rounded-lg bg-slate-50/70 p-3 cursor-pointer hover:border-primary/35 hover:bg-blue-50/40 transition-all"
              type="button"
              @click="goSearchWithCase(item)"
            >
              <strong class="block text-xs text-text-main line-clamp-2">{{ item.question }}</strong>
              <span class="block text-[11px] text-text-muted mt-1">命中 {{ formatPercent(resolveHitRate(item) ?? 0) }} · 召回 {{ formatPercent(resolveRecall(item) ?? 0) }} · {{ reviewLabel(resolveReviewStatus(item)) }}</span>
            </button>
          </div>
          <p v-else class="text-xs text-text-muted m-0 py-4">暂无需要优先复查的用例。</p>
        </aside>
      </section>

      <!-- 核心表格区 -->
      <section class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-5 shadow-[0_4px_20px_rgba(15,23,42,0.015)] flex flex-col gap-4">
        <div class="flex justify-between items-center">
          <h3 class="text-sm font-bold text-text-main m-0">测试用例列表 ({{ cases.length }})</h3>
          <button class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-border-main rounded-lg text-xs font-bold text-text-secondary cursor-pointer hover:bg-slate-50 hover:text-primary hover:border-primary-muted transition-all" @click="openCreateModal">
            <PlusIcon :size="13" /> 添加测试用例
          </button>
        </div>

        <div v-if="loading" class="flex flex-col items-center justify-center p-16 bg-white/65 rounded-xl border border-dashed border-border-main text-text-muted text-xs gap-3">
          <div class="w-7 h-7 border-3 border-blue-500/20 border-t-primary rounded-full animate-spin"></div>
          <p>加载评测清单中…</p>
        </div>
        <div v-else-if="cases.length === 0" class="flex flex-col items-center justify-center p-16 bg-white/65 rounded-xl border border-dashed border-border-main text-text-muted text-xs gap-3">
          <p>该知识库暂未创建测试用例</p>
          <button class="bg-transparent border-none text-primary font-bold cursor-pointer hover:underline" @click="openCreateModal">创建首条黄金测试用例</button>
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full border-collapse text-left">
            <thead>
              <tr>
                <th scope="col" class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">黄金问题 (Question)</th>
                <th scope="col" class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">预期答案/参考依据</th>
                <th scope="col" class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">上次评测答案</th>
                <th scope="col" class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">检索命中率</th>
                <th scope="col" class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">LLM 评分</th>
                <th scope="col" class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">审核状态</th>
                <th scope="col" class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in cases" :key="item.id">
                <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs text-text-secondary align-top max-w-[200px]">
                  <strong>{{ item.question }}</strong>
                </td>
                <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs text-text-secondary align-top max-w-[250px] whitespace-pre-wrap font-mono text-[11px] text-text-muted">{{ item.expectedAnswer || '未提供黄金参考' }}</td>
                <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs text-text-secondary align-top max-w-[250px] whitespace-pre-wrap font-mono text-[11px]">{{ resolveActualAnswer(item) || '暂无运行记录' }}</td>
                <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs text-text-secondary align-top">
                  <span class="inline-flex p-0.75 px-2 rounded-full text-[10.5px] font-bold" :class="scoreClass(resolveHitRate(item)) === 'score-high' ? 'bg-emerald-500/10 text-success' : scoreClass(resolveHitRate(item)) === 'score-mid' ? 'bg-amber-500/10 text-warning' : 'bg-red-500/10 text-error'">
                    {{ formatPercent(resolveHitRate(item)) }}
                  </span>
                </td>
                <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs text-text-secondary align-top">
                  <span class="inline-flex p-0.75 px-2 rounded-full text-[10.5px] font-bold" :class="scoreClass(resolveRecall(item)) === 'score-high' ? 'bg-emerald-500/10 text-success' : scoreClass(resolveRecall(item)) === 'score-mid' ? 'bg-amber-500/10 text-warning' : 'bg-red-500/10 text-error'">
                    {{ formatPercent(resolveRecall(item)) }}
                  </span>
                </td>
                <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs text-text-secondary align-top">
                  <span class="inline-flex p-0.75 px-2 rounded-sm text-[10.5px] font-bold" :class="resolveReviewStatus(item) === 'passed' ? 'bg-emerald-100 text-emerald-800' : resolveReviewStatus(item) === 'failed' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'">
                    {{ reviewLabel(resolveReviewStatus(item)) }}
                  </span>
                </td>
                <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs text-text-secondary align-top text-right">
                  <div class="flex justify-end gap-1">
                    <button class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer transition-all hover:border-primary/45 hover:text-primary hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed" title="立即运行此例" :disabled="running" @click="runSingleCase(item)">
                      <PlayIcon :size="13" />
                    </button>
                    <button class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer transition-all hover:border-primary/45 hover:text-primary hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed" title="通过审核" @click="reviewCase(item, 'passed')">
                      <CheckIcon :size="13" />
                    </button>
                    <button class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer transition-all hover:border-red-500/30 hover:text-error hover:bg-red-50/50 disabled:opacity-50 disabled:cursor-not-allowed" title="驳回/不通过" @click="reviewCase(item, 'failed')">
                      <XIcon :size="13" />
                    </button>
                    <button class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer transition-all hover:border-red-500/30 hover:text-error hover:bg-red-50/50 disabled:opacity-50 disabled:cursor-not-allowed" title="删除" @click="deleteCase(item)">
                      <Trash2Icon :size="13" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <!-- 创建 Modal -->
    <Teleport to="body">
      <div v-if="createOpen" class="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[1000] flex items-center justify-center" @click.self="createOpen = false">
        <div class="bg-white rounded-xl shadow-[0_20px_25px_-5px_rgba(15,23,42,0.1)] w-[500px] max-w-full overflow-hidden flex flex-col border border-border-main">
          <header class="p-5 border-b border-border-main flex items-center justify-between bg-slate-50/50">
            <h3 class="m-0 text-sm font-bold text-text-main">添加黄金测试用例</h3>
            <button class="bg-transparent border-none text-text-muted cursor-pointer" @click="createOpen = false">
              <XIcon :size="16" />
            </button>
          </header>
          <form class="p-5 flex flex-col gap-4 text-left" @submit.prevent="submitCreate">
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-bold text-text-secondary">黄金测试提问 <span class="text-error">*</span></label>
              <textarea v-model="form.question" class="w-full p-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary transition-all" rows="3" placeholder="输入用户真实可能提问的典型 query…" required></textarea>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-bold text-text-secondary">标准黄金答案 / 评测依据文段</label>
              <textarea v-model="form.expectedAnswer" class="w-full p-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary transition-all" rows="4" placeholder="大模型作答评测将以本段作为真值（Ground Truth）参考…"></textarea>
            </div>
            <footer class="p-5 border-t border-border-main flex justify-end gap-3 bg-slate-50/50">
              <button class="h-9 px-4 border border-border-main bg-white rounded-lg text-xs font-semibold text-text-secondary cursor-pointer hover:bg-slate-50" type="button" @click="createOpen = false">取消</button>
              <button class="h-9 px-5 bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-500 text-white border-none rounded-lg text-xs font-bold cursor-pointer hover:brightness-104 shadow-[0_4px_12px_rgba(99,102,241,0.2)] disabled:opacity-50" type="submit" :disabled="submitting">添加</button>
            </footer>
          </form>
        </div>
      </div>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PlayIcon,
  PlusIcon,
  CheckIcon,
  XIcon,
  Trash2Icon,
  ShieldCheckIcon,
  SearchIcon,
} from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import PageHeader from '@/components/common/PageHeader.vue'
import type { KnowledgeBase, KnowledgeEvalCase } from '@/types'

const kbApi = useKnowledgeBase()
const route = useRoute()
const router = useRouter()
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

const failedCases = computed(() =>
  cases.value.filter((item) => resolveLastRunStatus(item) === 'failed' || resolveReviewStatus(item) === 'failed'),
)

const lowHitCases = computed(() =>
  cases.value.filter((item) => {
    const score = resolveHitRate(item)
    return score !== null && score < 0.5
  }),
)

const unrunCases = computed(() => cases.value.filter((item) => !resolveLastRunStatus(item) && !resolveActualAnswer(item)))

const runningCases = computed(() => cases.value.filter((item) => resolveLastRunStatus(item) === 'running'))

const avgRetrievalLatency = computed(() => averageLatency('retrievalLatencyMs'))

const avgRerankLatency = computed(() => averageLatency('rerankLatencyMs'))

const diagnosticCards = computed(() => [
  { label: '失败用例', value: failedCases.value.length, hint: '运行失败或审核不通过' },
  { label: '低命中', value: lowHitCases.value.length, hint: '命中率低于 50%' },
  { label: '未运行', value: unrunCases.value.length, hint: '尚无评测结果' },
  { label: '运行中', value: runningCases.value.length, hint: '后端任务未完成' },
  { label: '平均耗时', value: formatMs(avgRetrievalLatency.value + avgRerankLatency.value), hint: '检索与重排' },
])

const failureBuckets = computed(() => [
  {
    key: 'retrieval',
    label: '检索不足',
    count: cases.value.filter((item) => {
      const hitRate = resolveHitRate(item)
      return hitRate !== null && hitRate < 0.35
    }).length,
    description: '通常需要检查分片质量、关键词召回、向量阈值和知识库范围。',
  },
  {
    key: 'rerank',
    label: '重排不足',
    count: cases.value.filter((item) => {
      const hitRate = resolveHitRate(item)
      const recall = resolveRecall(item)
      return hitRate !== null && recall !== null && hitRate >= 0.5 && recall < 0.5
    }).length,
    description: '候选已召回但最终排序不理想，可重点查看 Rerank 模型和 TopK 设置。',
  },
  {
    key: 'answer',
    label: '答案质量不足',
    count: cases.value.filter((item) => resolveLastRunStatus(item) === 'failed' && resolveHitRate(item) !== null && (resolveHitRate(item) ?? 0) >= 0.5).length,
    description: '证据可能存在，但生成答案不符合预期，需要复查提示词和引用约束。',
  },
  {
    key: 'review',
    label: '人工驳回',
    count: cases.value.filter((item) => resolveReviewStatus(item) === 'failed').length,
    description: '人工审核标记不通过，适合沉淀为回归测试优先用例。',
  },
])

const priorityReviewCases = computed(() =>
  cases.value
    .filter((item) => failedCases.value.includes(item) || lowHitCases.value.includes(item))
    .slice(0, 5),
)

onMounted(async () => {
  const list = await kbApi.listAll()
  kbs.value = list
  const routeKbId = typeof route.query.knowledgeBaseId === 'string' ? route.query.knowledgeBaseId : ''
  if (list.length > 0) {
    selectedKbId.value = list.some((kb) => kb.id === routeKbId) ? routeKbId : list[0].id
    void loadEvalCases()
  }

  const addQuestion = route.query.addQuestion
  const expectedAnswer = route.query.expectedAnswer
  if (typeof addQuestion === 'string') {
    form.value.question = addQuestion
    form.value.expectedAnswer = typeof expectedAnswer === 'string' ? expectedAnswer : ''
    createOpen.value = true

    // 清空 URL query 参数，避免刷新时反复弹窗
    const newQuery = { ...route.query }
    delete newQuery.addQuestion
    delete newQuery.expectedAnswer
    void router.replace({ query: newQuery })
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

function goSearchWithCase(item: KnowledgeEvalCase) {
  router.push({
    path: '/search',
    query: {
      knowledgeBaseId: selectedKbId.value,
      q: item.question,
    },
  })
}

function reviewFailedInSearch() {
  const first = priorityReviewCases.value[0]
  if (first) goSearchWithCase(first)
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

function resolveLastRunStatus(item: KnowledgeEvalCase): string {
  const record = item as KnowledgeEvalCase & { lastRunStatus?: string; last_run_status?: string }
  return record.lastRunStatus ?? record.last_run_status ?? ''
}

function averageLatency(field: 'retrievalLatencyMs' | 'rerankLatencyMs'): number {
  const snakeField = field === 'retrievalLatencyMs' ? 'retrieval_latency_ms' : 'rerank_latency_ms'
  const values = cases.value
    .map((item) => {
      const record = item as KnowledgeEvalCase & Record<string, number | undefined>
      return record[field] ?? record[snakeField]
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function formatMs(value: number): string {
  if (!value) return '-'
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.round(value)}ms`
}
</script>

<style scoped>
/* 评测分析已全部使用 Tailwind CSS 原子类替换，无须 scoped style */
</style>
