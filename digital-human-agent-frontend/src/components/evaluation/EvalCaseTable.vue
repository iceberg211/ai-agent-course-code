<template>
  <section class="bg-white/65 backdrop-blur-md border border-white/50 rounded-xl p-5 shadow-[0_4px_20px_rgba(15,23,42,0.015)] flex flex-col gap-4">
    <div class="flex justify-between items-center">
      <h3 class="text-sm font-bold text-text-main m-0">测试用例列表 ({{ cases.length }})</h3>
      <PermissionGate code="evaluation:manage">
        <button
          class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-border-main rounded-lg text-xs font-bold text-text-secondary cursor-pointer hover:bg-slate-50 hover:text-primary hover:border-primary-muted transition-all"
          type="button"
          @click="$emit('create')"
        >
          <PlusIcon :size="13" /> 添加测试用例
        </button>
      </PermissionGate>
    </div>

    <LoadingSkeleton v-if="loading" :rows="3" :row-height="72" label="加载评测清单" />
    <EmptyState v-else-if="cases.length === 0" title="该知识库暂未创建测试用例">
      <template #actions>
        <PermissionGate code="evaluation:manage">
          <button class="bg-transparent border-none text-primary font-bold cursor-pointer hover:underline" type="button" @click="$emit('create')">
            创建首条黄金测试用例
          </button>
        </PermissionGate>
      </template>
    </EmptyState>
    <div v-else class="overflow-x-auto">
      <table class="w-full border-collapse text-left">
        <thead>
          <tr>
            <th class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">黄金问题</th>
            <th class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">预期答案</th>
            <th class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">上次评测答案</th>
            <th class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">检索命中率</th>
            <th class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">LLM 评分</th>
            <th class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary">审核状态</th>
            <th class="p-3 px-3.5 border-b-2 border-slate-200/60 text-xs font-bold text-text-secondary text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in cases" :key="item.id">
            <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs align-top max-w-[200px]">
              <strong>{{ item.question }}</strong>
            </td>
            <td class="p-3 px-3.5 border-b border-slate-200/40 text-[11px] text-text-muted align-top max-w-[250px] whitespace-pre-wrap font-mono">
              {{ item.expectedAnswer || '未提供黄金参考' }}
            </td>
            <td class="p-3 px-3.5 border-b border-slate-200/40 text-[11px] align-top max-w-[250px] whitespace-pre-wrap font-mono">
              {{ resolveActualAnswer(item) || '暂无运行记录' }}
            </td>
            <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs align-top">
              <span class="inline-flex p-0.75 px-2 rounded-full text-[10.5px] font-bold" :class="scoreBadgeClass(resolveHitRate(item))">
                {{ formatPercent(resolveHitRate(item)) }}
              </span>
            </td>
            <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs align-top">
              <span class="inline-flex p-0.75 px-2 rounded-full text-[10.5px] font-bold" :class="scoreBadgeClass(resolveRecall(item))">
                {{ formatPercent(resolveRecall(item)) }}
              </span>
            </td>
            <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs align-top">
              <StatusBadge
                :label="reviewLabel(resolveReviewStatus(item))"
                :status="resolveReviewStatus(item) === 'passed' ? 'completed' : resolveReviewStatus(item) === 'failed' ? 'failed' : 'pending'"
              />
            </td>
            <td class="p-3 px-3.5 border-b border-slate-200/40 text-xs align-top text-right">
              <div class="flex justify-end gap-1">
                <PermissionGate code="evaluation:manage">
                  <button
                    class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer hover:border-primary/45 hover:text-primary disabled:opacity-50"
                    title="立即运行此例"
                    type="button"
                    :disabled="running"
                    @click="$emit('run', item)"
                  >
                    <PlayIcon :size="13" />
                  </button>
                </PermissionGate>
                <PermissionGate code="evaluation:manage">
                  <button
                    class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer hover:border-primary/45 hover:text-primary"
                    title="通过审核"
                    type="button"
                    @click="$emit('review', item, 'passed')"
                  >
                    <CheckIcon :size="13" />
                  </button>
                </PermissionGate>
                <PermissionGate code="evaluation:manage">
                  <button
                    class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer hover:border-red-500/30 hover:text-error"
                    title="驳回/不通过"
                    type="button"
                    @click="$emit('review', item, 'failed')"
                  >
                    <XIcon :size="13" />
                  </button>
                </PermissionGate>
                <PermissionGate code="evaluation:manage">
                  <button
                    class="w-7 h-7 rounded-md border border-border-main bg-white text-text-muted flex items-center justify-center cursor-pointer hover:border-red-500/30 hover:text-error"
                    title="删除"
                    type="button"
                    @click="$emit('delete', item)"
                  >
                    <Trash2Icon :size="13" />
                  </button>
                </PermissionGate>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { CheckIcon, PlayIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-vue-next'
import EmptyState from '@/components/common/EmptyState.vue'
import LoadingSkeleton from '@/components/common/LoadingSkeleton.vue'
import PermissionGate from '@/components/common/PermissionGate.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import {
  formatPercent,
  resolveActualAnswer,
  resolveHitRate,
  resolveRecall,
  resolveReviewStatus,
  reviewLabel,
  scoreBadgeClass,
} from '@/components/evaluation/evaluation.utils'
import type { KnowledgeEvalCase } from '@/types'

defineProps<{
  cases: KnowledgeEvalCase[]
  loading: boolean
  running: boolean
}>()

defineEmits<{
  (e: 'create'): void
  (e: 'run', item: KnowledgeEvalCase): void
  (e: 'review', item: KnowledgeEvalCase, status: 'passed' | 'failed'): void
  (e: 'delete', item: KnowledgeEvalCase): void
}>()
</script>
