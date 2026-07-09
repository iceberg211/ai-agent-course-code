<template>
  <section class="border border-border-main rounded-xl bg-white p-4 flex flex-col gap-3" aria-label="验证用例">
    <header class="flex items-center justify-between gap-3">
      <div>
        <p class="m-0 text-[10px] font-extrabold text-primary uppercase tracking-wide">用例库</p>
        <h3 class="m-0 text-sm font-bold text-text-main">常用验证问题</h3>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-text-muted">{{ cases.length }} 条</span>
        <PermissionGate code="evaluation:manage">
          <button
            class="h-8 px-3 border border-border-main rounded-lg bg-white text-[11px] font-bold text-text-secondary cursor-pointer hover:text-primary disabled:opacity-50"
            type="button"
            :disabled="!cases.length || batchRunning"
            @click="$emit('run-batch')"
          >
            {{ batchRunning ? '运行中' : '批量运行' }}
          </button>
        </PermissionGate>
      </div>
    </header>

    <div v-if="cases.length" class="flex flex-col gap-2 max-h-[360px] overflow-y-auto">
      <article
        v-for="item in cases"
        :key="item.id"
        class="border border-slate-200 rounded-lg p-2.5"
        :class="item.id === activeId ? 'border-primary/40 bg-primary/5' : 'bg-slate-50/50'"
      >
        <button class="w-full text-left bg-transparent border-none cursor-pointer p-0" type="button" @click="$emit('apply', item)">
          <strong class="block text-xs text-text-main">{{ item.question }}</strong>
          <small class="block text-[11px] text-text-muted mt-1">
            {{ resolveExpectedAnswer(item) || '未填写期望答案' }}
          </small>
          <span class="block text-[10.5px] text-text-muted mt-1">
            {{ runStatusLabel(resolveRunStatus(item)) }}
            <template v-if="resolveHitRate(item) != null"> · 命中率 {{ fmtPercent(resolveHitRate(item)) }}</template>
            <template v-if="resolveRecall(item) != null"> · 召回率 {{ fmtPercent(resolveRecall(item)) }}</template>
            · {{ reviewStatusLabel(resolveReviewStatus(item)) }}
          </span>
        </button>
        <div class="flex gap-1.5 mt-2 flex-wrap">
          <PermissionGate code="evaluation:manage">
            <button class="px-2 py-1 border border-border-main rounded bg-white text-[10.5px] cursor-pointer" type="button" @click="$emit('review', item.id, 'passed')">通过</button>
          </PermissionGate>
          <PermissionGate code="evaluation:manage">
            <button class="px-2 py-1 border border-border-main rounded bg-white text-[10.5px] cursor-pointer" type="button" @click="$emit('review', item.id, 'failed')">未通过</button>
          </PermissionGate>
          <button class="px-2 py-1 border border-border-main rounded bg-white text-[10.5px] cursor-pointer" type="button" @click="$emit('search', item)">搜索</button>
          <PermissionGate code="evaluation:manage">
            <button class="w-7 h-7 border border-border-main rounded bg-white text-text-muted cursor-pointer inline-flex items-center justify-center" type="button" aria-label="删除验证用例" @click="$emit('delete', item.id)">
              <Trash2Icon :size="14" />
            </button>
          </PermissionGate>
        </div>
      </article>
    </div>
    <p v-else class="m-0 text-xs text-text-muted">还没有保存验证问题。</p>
  </section>
</template>

<script setup lang="ts">
import { Trash2Icon } from 'lucide-vue-next'
import PermissionGate from '@/components/common/PermissionGate.vue'
import {
  formatPercent,
  resolveHitRate,
  resolveRecall,
  resolveReviewStatus,
} from '@/components/evaluation/evaluation.utils'
import type { KnowledgeEvalCase } from '@/types'

defineProps<{
  cases: KnowledgeEvalCase[]
  activeId: string | null
  batchRunning: boolean
}>()

defineEmits<{
  (e: 'apply', item: KnowledgeEvalCase): void
  (e: 'run-batch'): void
  (e: 'review', id: string, status: 'passed' | 'failed'): void
  (e: 'search', item: KnowledgeEvalCase): void
  (e: 'delete', id: string): void
}>()

function resolveExpectedAnswer(item: KnowledgeEvalCase) {
  return item.expectedAnswer || item.expected_answer || ''
}

function resolveRunStatus(item: KnowledgeEvalCase) {
  const record = item as KnowledgeEvalCase & { lastRunStatus?: string; last_run_status?: string }
  return record.lastRunStatus ?? record.last_run_status ?? ''
}

function runStatusLabel(status?: string) {
  if (status === 'passed' || status === 'completed') return '已运行'
  if (status === 'failed') return '失败'
  if (status === 'running') return '运行中'
  return '未运行'
}

function reviewStatusLabel(status?: string) {
  if (status === 'passed') return '已通过'
  if (status === 'failed') return '未通过'
  return '待审核'
}

function fmtPercent(value?: number | null) {
  return formatPercent(value)
}
</script>
