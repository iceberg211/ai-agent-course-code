<template>
  <div class="flex flex-col gap-4">
    <section class="border border-border-main rounded-xl bg-white p-4 flex flex-col gap-3" aria-label="知识库检索测试">
      <div>
        <p class="m-0 text-[10px] font-extrabold text-primary uppercase tracking-wide">问答验证</p>
        <h3 class="m-0 text-sm font-bold text-text-main">验证问题会命中哪些片段</h3>
        <p class="m-0 mt-1 text-xs text-text-muted">用于检查召回、重排、检索来源和最终引用候选，调整后不会自动保存到知识库配置。</p>
      </div>

      <div class="flex gap-2">
        <input
          v-model="query"
          type="text"
          class="flex-1 h-10 px-3 border border-border-main rounded-lg text-xs outline-none focus:border-primary"
          placeholder="输入一个真实用户问题"
          :disabled="hook.searching.value"
          @keydown.enter="runSearch"
        />
        <button
          class="h-10 px-4 bg-gradient-to-br from-blue-500 to-blue-700 text-white border-none rounded-lg text-xs font-bold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60"
          type="button"
          :disabled="!canSearch"
          @click="runSearch"
        >
          <SearchIcon :size="15" />
          {{ hook.searching.value ? '检索中' : '运行测试' }}
        </button>
      </div>

      <label class="flex flex-col gap-1.5">
        <span class="text-xs font-bold text-text-secondary">期望答案或验收要点</span>
        <textarea
          v-model="expectedAnswer"
          rows="3"
          class="w-full p-3 border border-border-main rounded-lg text-xs outline-none focus:border-primary"
          placeholder="可选，用来记录正确答案、必须命中的制度条款或人工验收标准"
        />
      </label>

      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
        <label class="flex flex-col gap-1 text-xs text-text-secondary">
          <span>阈值 {{ threshold.toFixed(2) }}</span>
          <input v-model.number="threshold" type="range" min="0" max="1" step="0.05" />
        </label>
        <label class="flex flex-col gap-1 text-xs text-text-secondary">
          <span>候选数</span>
          <input v-model.number="stage1TopK" type="number" min="1" max="50" class="h-8 px-2 border border-border-main rounded-md text-xs" />
        </label>
        <label class="flex flex-col gap-1 text-xs text-text-secondary">
          <span>最终数</span>
          <input v-model.number="finalTopK" type="number" min="1" max="20" class="h-8 px-2 border border-border-main rounded-md text-xs" />
        </label>
        <label class="inline-flex items-center gap-2 text-xs font-bold text-text-secondary h-8">
          <input v-model="rerank" type="checkbox" />
          <span>重排</span>
        </label>
        <div class="flex gap-2">
          <button class="h-8 px-3 border border-border-main rounded-lg bg-white text-[11px] font-bold cursor-pointer" type="button" @click="resetParams">
            恢复默认
          </button>
          <PermissionGate code="evaluation:manage">
            <button
              class="h-8 px-3 border border-border-main rounded-lg bg-white text-[11px] font-bold cursor-pointer inline-flex items-center gap-1 disabled:opacity-50"
              type="button"
              :disabled="!canSaveCase"
              @click="saveEvalCase"
            >
              <SaveIcon :size="14" />
              {{ activeEvalCaseId ? '更新用例' : '保存用例' }}
            </button>
          </PermissionGate>
        </div>
      </div>
      <p v-if="errorMsg" class="m-0 text-xs text-error" role="alert">{{ errorMsg }}</p>
    </section>

    <div class="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-4">
      <HitTestCasePanel
        :cases="evalCases"
        :active-id="activeEvalCaseId"
        :batch-running="batchRunning"
        @apply="applyEvalCase"
        @run-batch="runBatch"
        @review="reviewEvalCase"
        @search="sendFailedToSearch"
        @delete="deleteEvalCase"
      />
      <HitTestResultsPanel
        :result="result"
        :stage1="stage1"
        :stage2="stage2"
        :selected="selected"
        :expected-answer="expectedAnswer"
        @select="selected = $event"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { SaveIcon, SearchIcon } from 'lucide-vue-next'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import PermissionGate from '@/components/common/PermissionGate.vue'
import HitTestCasePanel from '@/components/knowledge-base/tabs/HitTestCasePanel.vue'
import HitTestResultsPanel from '@/components/knowledge-base/tabs/HitTestResultsPanel.vue'
import type {
  KnowledgeBase,
  KnowledgeEvalCase,
  KnowledgeSearchChunk,
  KnowledgeSearchResult,
} from '@/types'

const props = defineProps<{ kb: KnowledgeBase }>()
const hook = useKnowledgeBase()
const router = useRouter()

const query = ref('')
const threshold = ref(props.kb.retrievalConfig.threshold)
const stage1TopK = ref(props.kb.retrievalConfig.stage1TopK)
const finalTopK = ref(props.kb.retrievalConfig.finalTopK)
const rerank = ref(props.kb.retrievalConfig.rerank)
const expectedAnswer = ref('')
const evalCases = ref<KnowledgeEvalCase[]>([])
const activeEvalCaseId = ref<string | null>(null)
const loadingCases = ref(false)
const batchRunning = ref(false)
const result = ref<KnowledgeSearchResult | null>(null)
const selected = ref<KnowledgeSearchChunk | null>(null)
const errorMsg = ref('')

const canSearch = computed(() => !hook.searching.value && query.value.trim().length > 0)
const canSaveCase = computed(() => query.value.trim().length > 0 && !loadingCases.value)
const stage1 = computed(() => result.value?.hybridChunks ?? result.value?.stage1 ?? [])
const stage2 = computed(() => result.value?.rerankedChunks ?? result.value?.stage2 ?? [])

onMounted(() => {
  void loadEvalCases()
})

watch(
  () => props.kb.id,
  () => {
    query.value = ''
    expectedAnswer.value = ''
    activeEvalCaseId.value = null
    result.value = null
    selected.value = null
    resetParams()
    void loadEvalCases()
  },
)

function resetParams() {
  threshold.value = props.kb.retrievalConfig.threshold
  stage1TopK.value = props.kb.retrievalConfig.stage1TopK
  finalTopK.value = props.kb.retrievalConfig.finalTopK
  rerank.value = props.kb.retrievalConfig.rerank
}

async function runSearch() {
  if (!canSearch.value) return
  selected.value = null
  errorMsg.value = ''
  const r = await hook.searchInKb(props.kb.id, query.value, {
    threshold: threshold.value,
    stage1TopK: stage1TopK.value,
    finalTopK: finalTopK.value,
    rerank: rerank.value,
  })
  if (!r) {
    result.value = null
    errorMsg.value = '检索失败，请检查后端服务或模型配置'
    return
  }
  result.value = r
  selected.value = stage2.value[0] ?? stage1.value[0] ?? null
}

async function loadEvalCases() {
  loadingCases.value = true
  try {
    evalCases.value = await hook.listEvalCases(props.kb.id)
  } finally {
    loadingCases.value = false
  }
}

async function saveEvalCase() {
  if (!canSaveCase.value) return
  errorMsg.value = ''
  const payload = {
    question: query.value.trim(),
    expectedAnswer: expectedAnswer.value.trim(),
  }
  const saved = activeEvalCaseId.value
    ? await hook.updateEvalCase(props.kb.id, activeEvalCaseId.value, payload)
    : await hook.createEvalCase(props.kb.id, payload)
  if (!saved) {
    errorMsg.value = '验证用例保存失败'
    return
  }
  activeEvalCaseId.value = saved.id
  await loadEvalCases()
}

async function runBatch() {
  batchRunning.value = true
  errorMsg.value = ''
  try {
    evalCases.value = await hook.runEvalBatch(props.kb.id)
  } finally {
    batchRunning.value = false
  }
}

async function reviewEvalCase(evalCaseId: string, status: 'passed' | 'failed' | 'unreviewed') {
  const saved = await hook.updateEvalReview(props.kb.id, evalCaseId, status)
  if (!saved) {
    errorMsg.value = '人工审核状态保存失败'
    return
  }
  await loadEvalCases()
}

function sendFailedToSearch(item: KnowledgeEvalCase) {
  localStorage.setItem('__draft_rag_search', item.question)
  router.push({ path: '/search', query: { q: item.question, knowledgeBaseId: props.kb.id } })
}

async function applyEvalCase(item: KnowledgeEvalCase) {
  activeEvalCaseId.value = item.id
  query.value = item.question
  expectedAnswer.value =
    item.expectedAnswer || (item as KnowledgeEvalCase & { expected_answer?: string }).expected_answer || ''
  await runSearch()
}

async function deleteEvalCase(id: string) {
  if (!confirm('确定删除此验证用例吗？')) return
  const ok = await hook.deleteEvalCase(props.kb.id, id)
  if (!ok) {
    errorMsg.value = '删除验证用例失败'
    return
  }
  if (activeEvalCaseId.value === id) activeEvalCaseId.value = null
  await loadEvalCases()
}
</script>
