<template>
  <SideDrawer
    :open="open && !!message"
    title="回答可解释面板"
    :subtitle="subtitle"
    width="420px"
    @close="$emit('close')"
  >
    <div v-if="message" class="flex flex-col gap-4 text-left">
      <section class="grid grid-cols-2 gap-2">
        <MetricCard label="引用数" :value="citations.length" hint="可核验证据片段" />
        <MetricCard
          label="总耗时"
          :value="latencyLabel"
          hint="端到端问答时延"
        />
        <MetricCard
          label="Rerank 耗时"
          :value="rerankLatencyLabel"
          hint="语义重排阶段"
        />
        <MetricCard
          label="反馈"
          :value="feedbackLabel"
          :warn="message.feedback === 'down'"
          hint="用户质量反馈"
        />
      </section>

      <TracePanel :title="'RAG Trace'" :summary="traceSummary" :blocks="traceBlocks" />

      <section class="bg-white border border-slate-200/60 rounded-lg p-3">
        <h5 class="m-0 mb-2 text-xs font-bold text-text-main">引用证据</h5>
        <div v-if="citations.length" class="flex flex-col gap-2">
          <button
            v-for="(c, idx) in citations"
            :key="c.id || `${c.source}-${idx}`"
            class="text-left border border-slate-200 rounded-lg p-2.5 bg-slate-50/70 hover:border-primary/35 hover:bg-blue-50/40 cursor-pointer"
            type="button"
            @click="$emit('open-citation', c)"
          >
            <strong class="block text-xs text-text-main truncate">{{ c.source || `引用 ${idx + 1}` }}</strong>
            <span class="block text-[11px] text-text-muted mt-1">
              第 {{ (c.chunkIndex ?? c.chunk_index ?? 0) + 1 }} 段
              <template v-if="c.similarity != null"> · 相似度 {{ Number(c.similarity).toFixed(3) }}</template>
              <template v-if="c.rerank_score != null"> · Rerank {{ Number(c.rerank_score).toFixed(3) }}</template>
            </span>
          </button>
        </div>
        <p v-else class="m-0 text-xs text-text-muted">该回答未返回可核验引用。</p>
      </section>

      <section class="bg-white border border-slate-200/60 rounded-lg p-3">
        <h5 class="m-0 mb-2 text-xs font-bold text-text-main">图谱推理</h5>
        <div v-if="graphPaths.length" class="flex flex-col gap-1.5 font-mono text-[11px] text-text-secondary">
          <p v-for="(path, idx) in graphPaths" :key="idx" class="m-0 leading-relaxed">
            ({{ path.sourceNode || path.source || '?' }}) — [{{ path.relation || path.edge || 'rel' }}] →
            ({{ path.targetNode || path.target || '?' }})
          </p>
        </div>
        <p v-else class="m-0 text-xs text-text-muted">
          图谱召回 {{ graphResultCount }} 条，暂无详细路径。
        </p>
      </section>

      <section class="bg-white border border-slate-200/60 rounded-lg p-3">
        <h5 class="m-0 mb-2 text-xs font-bold text-text-main">记忆使用</h5>
        <div class="text-[11.5px] text-text-secondary flex flex-col gap-1.5">
          <div class="flex justify-between gap-2">
            <span>短期记忆 (Redis/会话)</span>
            <strong>{{ shortMemoryLabel }}</strong>
          </div>
          <div class="flex justify-between gap-2">
            <span>长期记忆 (mem0)</span>
            <strong>{{ longMemoryLabel }}</strong>
          </div>
          <p class="m-0 text-[10.5px] text-text-muted leading-relaxed">
            {{ memoryHint }}
          </p>
        </div>
      </section>

      <section class="bg-red-50/40 border border-red-200/60 rounded-lg p-3">
        <h5 class="m-0 mb-2 text-xs font-bold text-text-main">权限过滤</h5>
        <div class="text-[11.5px] text-text-secondary flex flex-col gap-1.5">
          <div class="flex justify-between gap-2">
            <span>过滤片段</span>
            <strong class="text-error">{{ permissionFilteredCount }}</strong>
          </div>
          <div class="flex justify-between gap-2">
            <span>策略</span>
            <strong>{{ permissionStrategy }}</strong>
          </div>
        </div>
      </section>

      <div class="flex gap-2">
        <button
          class="flex-1 px-3 py-2 border border-border-main rounded-lg bg-white text-xs font-bold text-text-secondary cursor-pointer hover:border-primary hover:text-primary"
          type="button"
          @click="$emit('import-eval')"
        >
          转为评估用例
        </button>
      </div>
    </div>
  </SideDrawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SideDrawer from '@/components/common/SideDrawer.vue'
import MetricCard from '@/components/common/MetricCard.vue'
import TracePanel, { type TraceBlock, type TraceSummaryItem } from '@/components/common/TracePanel.vue'
import type { ChatMessage, Citation } from '@/types'

const props = defineProps<{
  open: boolean
  message: ChatMessage | null
}>()

defineEmits<{
  (e: 'close'): void
  (e: 'open-citation', citation: Citation): void
  (e: 'import-eval'): void
}>()

const ragTrace = computed(() => props.message?.ragTrace || props.message?.rag_trace || {})

const citations = computed(() => props.message?.citations || [])

const subtitle = computed(() => {
  if (!props.message) return ''
  const content = props.message.content || ''
  return content.length > 48 ? `${content.slice(0, 48)}…` : content
})

const latencyLabel = computed(() => {
  const ms = props.message?.latencyMs ?? props.message?.latency_ms
  return ms != null ? `${ms} ms` : '-'
})

const rerankLatencyLabel = computed(() => {
  const ms = ragTrace.value?.rerankLatencyMs ?? ragTrace.value?.rerank_latency_ms
  return ms != null ? `${ms} ms` : '-'
})

const feedbackLabel = computed(() => {
  if (props.message?.feedback === 'up') return '有用'
  if (props.message?.feedback === 'down') return '无用'
  return '未反馈'
})

const graphResultCount = computed(
  () => Number(ragTrace.value?.graphResultCount ?? ragTrace.value?.graph_result_count ?? 0),
)

const graphPaths = computed(() => {
  const raw =
    props.message?.graphReasoningTrace ||
    props.message?.graph_reasoning_trace ||
    ragTrace.value?.graphPaths ||
    []
  return Array.isArray(raw) ? raw : []
})

const permissionFilteredCount = computed(
  () =>
    Number(
      ragTrace.value?.permissionFilteredCount ??
        ragTrace.value?.permission_filtered_count ??
        ragTrace.value?.aclFilteredCount ??
        0,
    ),
)

const permissionStrategy = computed(
  () =>
    ragTrace.value?.permissionStrategy ||
    ragTrace.value?.permission_filter_strategy ||
    'ACL / 可见范围',
)

const shortMemoryLabel = computed(() => {
  const count =
    ragTrace.value?.shortTermMemoryCount ??
    ragTrace.value?.sessionMemoryCount ??
    ragTrace.value?.redisMemoryCount
  if (count != null) return `${count} 条`
  return ragTrace.value?.usedSessionMemory ? '已使用' : '未标注'
})

const longMemoryLabel = computed(() => {
  const count = ragTrace.value?.longTermMemoryCount ?? ragTrace.value?.mem0Count
  if (count != null) return `${count} 条`
  return ragTrace.value?.usedMem0 || ragTrace.value?.usedLongTermMemory ? '已使用' : '未标注'
})

const memoryHint = computed(() => {
  if (shortMemoryLabel.value === '未标注' && longMemoryLabel.value === '未标注') {
    return '后端未在消息 Trace 中返回记忆使用明细时，将显示“未标注”。可在个人中心管理 mem0 长期记忆。'
  }
  return '短期记忆来自当前会话上下文，长期记忆来自 mem0 用户画像与偏好。'
})

const traceSummary = computed<TraceSummaryItem[]>(() => [
  {
    label: '向量召回',
    value: Number(ragTrace.value?.vectorResultCount ?? ragTrace.value?.vector_result_count ?? 0),
  },
  {
    label: '关键词召回',
    value: Number(ragTrace.value?.keywordResultCount ?? ragTrace.value?.keyword_result_count ?? 0),
  },
  { label: '图谱召回', value: graphResultCount.value },
  { label: '最终引用', value: citations.value.length },
])

const traceBlocks = computed<TraceBlock[]>(() => {
  const rewrite =
    ragTrace.value?.rewrittenQuery ||
    ragTrace.value?.rewritten_query ||
    ragTrace.value?.queryRewrite
  const rewriteList = Array.isArray(rewrite) ? rewrite : rewrite ? [String(rewrite)] : []

  return [
    {
      key: 'rewrite',
      title: 'Query Rewrite',
      list: rewriteList.length ? rewriteList : ['未返回改写结果，使用原始问题检索'],
    },
    {
      key: 'channels',
      title: '多路召回',
      rows: [
        {
          label: 'Vector',
          value: Number(ragTrace.value?.vectorResultCount ?? ragTrace.value?.vector_result_count ?? 0),
        },
        {
          label: 'Keyword',
          value: Number(ragTrace.value?.keywordResultCount ?? ragTrace.value?.keyword_result_count ?? 0),
        },
        { label: 'Graph', value: graphResultCount.value },
      ],
    },
    {
      key: 'permission',
      title: '权限过滤',
      tone: permissionFilteredCount.value > 0 ? 'danger' : 'default',
      rows: [
        { label: '过滤数量', value: permissionFilteredCount.value },
        { label: '策略', value: permissionStrategy.value },
      ],
    },
  ]
})
</script>
