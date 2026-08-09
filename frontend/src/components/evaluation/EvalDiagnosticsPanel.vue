<template>
  <section class="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
    <div class="bg-white border border-border-main rounded-xl p-5 flex flex-col gap-4">
      <div class="flex justify-between items-start gap-4">
        <div>
          <h3 class="text-sm font-bold text-text-main m-0">失败分析与运行诊断</h3>
          <p class="text-xs text-text-muted m-0 mt-1">聚合最近一次评测结果，用于发现检索、重排和人工审核中的薄弱项。</p>
        </div>
        <button
          class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-border-main rounded-lg text-xs font-bold text-text-secondary cursor-pointer hover:bg-slate-50 hover:text-primary disabled:opacity-50"
          type="button"
          :disabled="priorityCases.length === 0"
          @click="$emit('review-failed')"
        >
          <SearchIcon :size="13" />
          <span>复查失败用例</span>
        </button>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard
          v-for="item in diagnosticCards"
          :key="item.label"
          :label="item.label"
          :value="item.value"
          :hint="item.hint"
        />
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
      <div v-if="priorityCases.length" class="flex flex-col gap-2">
        <button
          v-for="item in priorityCases"
          :key="item.id"
          class="text-left border border-slate-200 rounded-lg bg-slate-50/70 p-3 cursor-pointer hover:border-primary/35 hover:bg-blue-50/40 transition-all"
          type="button"
          @click="$emit('open-case', item)"
        >
          <strong class="block text-xs text-text-main line-clamp-2">{{ item.question }}</strong>
          <span class="block text-[11px] text-text-muted mt-1">
            命中 {{ formatPercent(resolveHitRate(item) ?? 0) }} · 召回 {{ formatPercent(resolveRecall(item) ?? 0) }} ·
            {{ reviewLabel(resolveReviewStatus(item)) }}
          </span>
        </button>
      </div>
      <p v-else class="text-xs text-text-muted m-0 py-4">暂无需要优先复查的用例。</p>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { SearchIcon } from 'lucide-vue-next'
import MetricCard from '@/components/common/MetricCard.vue'
import {
  formatPercent,
  resolveHitRate,
  resolveRecall,
  resolveReviewStatus,
  reviewLabel,
} from '@/components/evaluation/evaluation.utils'
import type { KnowledgeEvalCase } from '@/types'

defineProps<{
  diagnosticCards: Array<{ label: string; value: string | number; hint: string }>
  failureBuckets: Array<{ key: string; label: string; count: number; description: string }>
  priorityCases: KnowledgeEvalCase[]
}>()

defineEmits<{
  (e: 'review-failed'): void
  (e: 'open-case', item: KnowledgeEvalCase): void
}>()
</script>
