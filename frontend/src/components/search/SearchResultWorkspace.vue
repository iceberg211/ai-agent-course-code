<template>
  <section class="flex-1 bg-white border border-border-main rounded-xl overflow-hidden min-h-[600px]">
    <LoadingSkeleton v-if="searching" :rows="4" :row-height="80" label="检索中" />

    <EmptyState
      v-else-if="!searched"
      title="开始混合检索"
      description="在上方选择测试知识库并提问，右侧将呈现完整的合流 Trace 与权限过滤统计。"
      :icon="SearchIcon"
    />

    <EmptyState
      v-else-if="results.length === 0"
      title="未检索到可用分片"
      description="可能不满足筛选条件，或账户在 ACL 过滤器中无访问权限。"
      :icon="AlertCircleIcon"
    />

    <div v-else class="grid grid-cols-1 md:grid-cols-[280px_1fr_300px] h-[600px] text-left">
      <div class="border-r border-slate-200/50 flex flex-col overflow-hidden">
        <header class="p-3.5 border-b border-slate-200/50 flex justify-between items-center text-[11.5px] font-bold text-text-muted">
          <span>找到 {{ results.length }} 条匹配片段</span>
          <StatusBadge :label="rerank ? 'Rerank 已重排' : 'RRF 原始输出'" :tone="rerank ? 'success' : 'neutral'" />
        </header>
        <ul class="list-none p-0 m-0 flex-1 overflow-y-auto">
          <li
            v-for="(c, idx) in results"
            :key="c.id"
            class="p-3.5 border-b border-slate-200/40 cursor-pointer flex gap-2.5 hover:bg-slate-50/50"
            :class="activeChunk?.id === c.id ? '!bg-primary-bg !text-primary' : ''"
            @click="$emit('select', c)"
          >
            <span
              class="bg-slate-100 w-5 h-5 rounded-full inline-flex items-center justify-center text-[11px] font-bold text-text-secondary shrink-0"
              :class="activeChunk?.id === c.id ? '!bg-primary !text-white' : ''"
            >
              {{ idx + 1 }}
            </span>
            <div class="flex-1 flex flex-col gap-1 min-w-0">
              <strong class="text-[13px] font-bold text-text-main line-clamp-1" :title="c.source">{{ c.source }}</strong>
              <span class="text-[11px] text-text-muted">
                第 {{ (c.chunkIndex ?? c.chunk_index) + 1 }} 段 · 分数 {{ formatScore(c) }}
              </span>
              <div class="flex gap-1 mt-0.5 flex-wrap">
                <span
                  v-for="src in c.retrieval_sources"
                  :key="src"
                  class="text-[9px] p-0.25 px-1 rounded-[3px] font-bold"
                  :class="channelBadgeClass(src)"
                >
                  {{ channelLabel(src) }}
                </span>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <article class="p-5 flex flex-col overflow-y-auto">
        <div v-if="activeChunk" class="flex flex-col h-full">
          <header class="border-b border-slate-200/50 pb-3.5 flex justify-between items-start gap-4">
            <div>
              <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">当前选中切片内容</span>
              <h4 class="text-sm font-bold text-text-main m-0 mt-1">{{ activeChunk.source }}</h4>
              <p class="text-xs text-text-secondary m-0 mt-1">
                索引位置: 第 {{ (activeChunk.chunkIndex ?? activeChunk.chunk_index) + 1 }} 段 ·
                向量相似度: {{ activeChunk.similarity?.toFixed(4) ?? '-' }}
                <template v-if="activeChunk.rerank_score != null">
                  · 重排分值: {{ activeChunk.rerank_score.toFixed(4) }}
                </template>
              </p>
            </div>
            <div class="flex gap-2 flex-wrap justify-end">
              <button class="p-1.5 px-3 border border-border-main bg-white rounded-md text-xs font-bold text-text-secondary cursor-pointer inline-flex items-center gap-1 hover:bg-slate-50" type="button" @click="$emit('inspect-context', activeChunk)">
                <EyeIcon :size="14" />
                <span>完整上下文</span>
              </button>
              <button class="p-1.5 px-3 bg-primary text-white border-none rounded-md text-xs font-bold cursor-pointer inline-flex items-center gap-1 hover:brightness-104 shadow-btn" type="button" @click="$emit('start-chat', activeChunk)">
                <MessageSquareIcon :size="13" />
                <span>去对话验证</span>
              </button>
              <button class="p-1.5 px-3 border border-border-main bg-white rounded-md text-xs font-bold text-text-secondary cursor-pointer inline-flex items-center gap-1 hover:bg-slate-50" type="button" @click="$emit('create-eval', activeChunk)">
                <CheckSquareIcon :size="13" />
                <span>转评估用例</span>
              </button>
            </div>
          </header>
          <div class="flex-1 mt-3.5">
            <pre class="text-[13.5px] leading-relaxed whitespace-pre-wrap text-text-secondary font-mono" v-html="highlightContent(activeChunk.content, query)" />
          </div>
        </div>
        <div v-else class="flex items-center justify-center h-full text-text-muted text-xs">
          <p>在左侧选择特定片段，查看具体段落和操作</p>
        </div>
      </article>

      <aside class="border-l border-slate-200/50 bg-slate-50 flex flex-col overflow-hidden">
        <div class="p-4 flex-1 overflow-y-auto">
          <TracePanel :summary="traceSummary" :blocks="traceBlocks" />
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  AlertCircleIcon,
  CheckSquareIcon,
  EyeIcon,
  MessageSquareIcon,
  SearchIcon,
} from 'lucide-vue-next'
import EmptyState from '@/components/common/EmptyState.vue'
import LoadingSkeleton from '@/components/common/LoadingSkeleton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import TracePanel, { type TraceBlock, type TraceSummaryItem } from '@/components/common/TracePanel.vue'
import { channelBadgeClass, channelLabel } from '@/hooks/useSearchTrace'
import type { KnowledgeSearchChunk } from '@/types'

defineProps<{
  searching: boolean
  searched: boolean
  results: KnowledgeSearchChunk[]
  activeChunk: KnowledgeSearchChunk | null
  query: string
  rerank: boolean
  traceSummary: TraceSummaryItem[]
  traceBlocks: TraceBlock[]
}>()

defineEmits<{
  (e: 'select', chunk: KnowledgeSearchChunk): void
  (e: 'inspect-context', chunk: KnowledgeSearchChunk): void
  (e: 'start-chat', chunk: KnowledgeSearchChunk): void
  (e: 'create-eval', chunk: KnowledgeSearchChunk): void
}>()

function formatScore(c: KnowledgeSearchChunk): string {
  if (c.rerank_score != null) return `重排 ${c.rerank_score.toFixed(3)}`
  return `相似 ${c.similarity?.toFixed(3) ?? '-'}`
}

function highlightContent(content: string, q: string) {
  if (!content) return ''
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (!q?.trim()) return escaped
  const escapedQuery = q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').trim()
  if (!escapedQuery) return escaped
  try {
    const regex = new RegExp(`(${escapedQuery})`, 'gi')
    return escaped.replace(
      regex,
      '<mark class="bg-amber-100/90 text-amber-950 font-semibold rounded-[2px] px-0.5">$1</mark>',
    )
  } catch {
    return escaped
  }
}
</script>
