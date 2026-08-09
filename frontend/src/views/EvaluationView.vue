<template>
  <main class="p-6 h-full overflow-y-auto bg-transparent text-left flex flex-col gap-6 w-full box-border">
    <PageHeader
      eyebrow="质量运营"
      title="评估验证"
      description="管理评估集、批量运行检索验证、审核失败用例并沉淀回归案例。"
    >
      <template #actions>
        <div class="flex items-center gap-3">
          <select
            v-model="selectedKbId"
            class="h-10 px-3 border border-border-main rounded-lg bg-white text-text-main outline-none text-xs focus:border-primary"
            @change="loadEvalCases"
          >
            <option value="" disabled>选择要评估的知识库</option>
            <option v-for="kb in kbs" :key="kb.id" :value="kb.id">{{ kb.name }}</option>
          </select>
          <button
            class="inline-flex items-center gap-1.5 px-4.5 py-2.5 border border-slate-200 bg-white hover:border-primary-muted hover:text-primary rounded-lg text-[12.5px] font-bold cursor-pointer"
            type="button"
            :disabled="!selectedKbId"
            @click="openSandbox"
          >
            <LayersIcon :size="14" />
            <span>检索策略 Sandbox 对比</span>
          </button>
          <PermissionGate code="evaluation:manage">
            <button
              class="inline-flex items-center gap-1.5 px-4.5 py-2.5 bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none rounded-lg text-[12.5px] font-bold cursor-pointer shadow-btn disabled:opacity-60"
              type="button"
              :disabled="running || !selectedKbId"
              @click="runEvaluation"
            >
              <PlayIcon :size="15" :class="{ 'animate-spin': running }" />
              <span>{{ running ? '批量评测运行中…' : '运行批量评测' }}</span>
            </button>
          </PermissionGate>
        </div>
      </template>
    </PageHeader>

    <EmptyState
      v-if="!selectedKbId"
      title="请选择目标知识库"
      description="选择一个知识库以查看其对应的黄金测试集与最近运行统计"
      :icon="ShieldCheckIcon"
    />

    <div v-else class="flex flex-col gap-6">
      <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="测试用例总数" :value="cases.length" hint="黄金评测数据集" />
        <MetricCard label="平均检索命中率" :value="formatPercent(avgHitRate)" hint="Top-K 黄金片段覆盖率" />
        <MetricCard label="黄金召回率" :value="formatPercent(avgRecall)" hint="语义重排最终覆盖率" />
        <MetricCard
          label="人工验证通过率"
          :value="formatPercent(verifiedPassRate)"
          hint="黄金测试审核通过"
          :warn="verifiedPassRate < 0.5"
        />
      </section>

      <EvalDiagnosticsPanel
        :diagnostic-cards="diagnosticCards"
        :failure-buckets="failureBuckets"
        :priority-cases="priorityReviewCases"
        @review-failed="reviewFailedInSearch"
        @open-case="goSearchWithCase"
      />

      <EvalCaseTable
        :cases="cases"
        :loading="loading"
        :running="running"
        @create="openCreateModal"
        @run="runSingleCase"
        @review="reviewCase"
        @delete="deleteCase"
      />
    </div>

    <EvalCreateModal
      :open="createOpen"
      :question="form.question"
      :expected-answer="form.expectedAnswer"
      :submitting="submitting"
      @close="createOpen = false"
      @submit="submitCreate"
    />

    <EvalSandboxModal
      v-model:query="sandboxQuery"
      :open="sandboxOpen"
      :comparing="sandboxComparing"
      :result-a="sandboxResultA"
      :result-b="sandboxResultB"
      :result-c="sandboxResultC"
      @close="sandboxOpen = false"
      @compare="runSandboxCompare"
    />

    <ConfirmDialog
      :open="confirmOpen"
      :title="confirmTitle"
      :description="confirmDescription"
      danger
      :loading="confirmLoading"
      @confirm="runConfirm"
      @cancel="confirmOpen = false"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LayersIcon, PlayIcon, ShieldCheckIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import PageHeader from '@/components/common/PageHeader.vue'
import PermissionGate from '@/components/common/PermissionGate.vue'
import MetricCard from '@/components/common/MetricCard.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import EvalCaseTable from '@/components/evaluation/EvalCaseTable.vue'
import EvalDiagnosticsPanel from '@/components/evaluation/EvalDiagnosticsPanel.vue'
import EvalCreateModal from '@/components/evaluation/EvalCreateModal.vue'
import EvalSandboxModal from '@/components/evaluation/EvalSandboxModal.vue'
import {
  buildDiagnosticCards,
  buildFailureBuckets,
  formatPercent,
  resolveHitRate,
  resolveLastRunStatus,
  resolveRecall,
  resolveReviewStatus,
} from '@/components/evaluation/evaluation.utils'
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
const form = ref({ question: '', expectedAnswer: '' })

const sandboxOpen = ref(false)
const sandboxComparing = ref(false)
const sandboxQuery = ref('')
const sandboxResultA = ref<any>(null)
const sandboxResultB = ref<any>(null)
const sandboxResultC = ref<any>(null)

const confirmOpen = ref(false)
const confirmTitle = ref('')
const confirmDescription = ref('')
const confirmLoading = ref(false)
let pendingDelete: KnowledgeEvalCase | null = null

const avgHitRate = computed(() => {
  if (!cases.value.length) return 0
  return cases.value.reduce((acc, c) => acc + (resolveHitRate(c) ?? 0), 0) / cases.value.length
})
const avgRecall = computed(() => {
  if (!cases.value.length) return 0
  return cases.value.reduce((acc, c) => acc + (resolveRecall(c) ?? 0), 0) / cases.value.length
})
const verifiedPassRate = computed(() => {
  if (!cases.value.length) return 0
  return cases.value.filter((c) => resolveReviewStatus(c) === 'passed').length / cases.value.length
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
const diagnosticCards = computed(() => buildDiagnosticCards(cases.value))
const failureBuckets = computed(() => buildFailureBuckets(cases.value))
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

async function reviewCase(item: KnowledgeEvalCase, status: 'passed' | 'failed') {
  const updated = await kbApi.updateEvalReview(selectedKbId.value, item.id, status)
  if (updated) {
    const idx = cases.value.findIndex((c) => c.id === item.id)
    if (idx !== -1) cases.value[idx] = updated
  }
}

function deleteCase(item: KnowledgeEvalCase) {
  pendingDelete = item
  confirmTitle.value = '删除测试用例'
  confirmDescription.value = `确定删除「${item.question.slice(0, 40)}」吗？`
  confirmOpen.value = true
}

async function runConfirm() {
  if (!pendingDelete) return
  confirmLoading.value = true
  try {
    const deleted = await kbApi.deleteEvalCase(selectedKbId.value, pendingDelete.id)
    if (deleted) cases.value = cases.value.filter((c) => c.id !== pendingDelete!.id)
    confirmOpen.value = false
  } finally {
    confirmLoading.value = false
    pendingDelete = null
  }
}

function goSearchWithCase(item: KnowledgeEvalCase) {
  router.push({
    path: '/search',
    query: { knowledgeBaseId: selectedKbId.value, q: item.question },
  })
}

function reviewFailedInSearch() {
  const first = priorityReviewCases.value[0]
  if (first) goSearchWithCase(first)
}

function openCreateModal() {
  form.value = { question: '', expectedAnswer: '' }
  createOpen.value = true
}

async function submitCreate(payload: { question: string; expectedAnswer: string }) {
  submitting.value = true
  try {
    const created = await kbApi.createEvalCase(selectedKbId.value, payload)
    if (created) {
      cases.value.push(created)
      createOpen.value = false
    }
  } finally {
    submitting.value = false
  }
}

function openSandbox() {
  sandboxQuery.value = priorityReviewCases.value[0]?.question || cases.value[0]?.question || ''
  sandboxResultA.value = null
  sandboxResultB.value = null
  sandboxResultC.value = null
  sandboxOpen.value = true
}

async function runSandboxCompare() {
  if (!sandboxQuery.value.trim() || !selectedKbId.value) return
  sandboxComparing.value = true
  try {
    const q = sandboxQuery.value.trim()
    const kbId = selectedKbId.value
    const pickChunks = (res: Awaited<ReturnType<typeof kbApi.searchInKb>>) =>
      res?.stage2 ?? res?.rerankedChunks ?? res?.hybridChunks ?? res?.stage1 ?? []

    const startedA = Date.now()
    const promiseA = kbApi.searchInKb(kbId, q, { useGraph: false, rerank: false }).then((res) => ({
      chunks: pickChunks(res),
      latencyMs: Date.now() - startedA,
    }))
    const startedB = Date.now()
    const promiseB = kbApi.searchInKb(kbId, q, { useGraph: true, rerank: false }).then((res) => ({
      chunks: pickChunks(res),
      latencyMs: Date.now() - startedB,
    }))
    const startedC = Date.now()
    const promiseC = kbApi.searchInKb(kbId, q, { useGraph: true, rerank: true }).then((res) => ({
      chunks: pickChunks(res),
      latencyMs: Date.now() - startedC,
    }))
    ;[sandboxResultA.value, sandboxResultB.value, sandboxResultC.value] = await Promise.all([
      promiseA,
      promiseB,
      promiseC,
    ])
  } finally {
    sandboxComparing.value = false
  }
}
</script>
