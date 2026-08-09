<template>
  <section v-if="result" class="border border-border-main rounded-xl bg-white p-4 flex flex-col gap-4" aria-label="检索结果">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <p class="m-0 text-[10px] font-extrabold text-primary uppercase tracking-wide">检索结果</p>
        <h3 class="m-0 text-sm font-bold text-text-main">{{ result.query }}</h3>
      </div>
      <dl class="m-0 flex gap-3 text-[11px]">
        <div class="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
          <dt class="text-text-muted">召回</dt>
          <dd class="m-0 font-bold text-text-main">{{ stage1.length }}</dd>
        </div>
        <div class="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
          <dt class="text-text-muted">最终</dt>
          <dd class="m-0 font-bold text-text-main">{{ stage2.length }}</dd>
        </div>
        <div class="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
          <dt class="text-text-muted">模式</dt>
          <dd class="m-0 font-bold text-text-main">{{ result.options?.rerank ? 'Rerank' : '截断' }}</dd>
        </div>
      </dl>
    </div>

    <aside v-if="expectedAnswer.trim()" class="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <p class="m-0 text-[10px] font-extrabold text-amber-800 uppercase">期望答案</p>
      <pre class="m-0 mt-1 whitespace-pre-wrap text-xs text-text-secondary font-sans">{{ expectedAnswer.trim() }}</pre>
    </aside>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <article class="border border-slate-200 rounded-lg p-3">
        <header class="mb-2">
          <span class="text-[10px] text-text-muted font-bold">Stage 1</span>
          <strong class="block text-xs text-text-main">混合召回</strong>
        </header>
        <ol v-if="stage1.length" class="list-none m-0 p-0 flex flex-col gap-1.5">
          <li v-for="(c, index) in stage1" :key="`s1-${c.id}`">
            <button
              class="w-full text-left border rounded-md p-2 bg-white cursor-pointer"
              :class="selected?.id === c.id ? 'border-primary bg-primary/5' : 'border-slate-200'"
              type="button"
              @click="$emit('select', c)"
            >
              <span class="text-[11px] font-bold text-text-muted">#{{ index + 1 }}</span>
              <strong class="block text-xs text-text-main mt-0.5">{{ c.source }}</strong>
              <small class="text-[10.5px] text-text-muted">第 {{ (c.chunkIndex ?? c.chunk_index) + 1 }} 段 · 相似度 {{ fmt(c.similarity) }}</small>
            </button>
          </li>
        </ol>
        <p v-else class="m-0 text-xs text-text-muted">无结果</p>
      </article>

      <article class="border border-slate-200 rounded-lg p-3">
        <header class="mb-2">
          <span class="text-[10px] text-text-muted font-bold">Stage 2</span>
          <strong class="block text-xs text-text-main">{{ result.options?.rerank ? '重排结果' : '最终结果' }}</strong>
        </header>
        <ol v-if="stage2.length" class="list-none m-0 p-0 flex flex-col gap-1.5">
          <li v-for="(c, index) in stage2" :key="`s2-${c.id}`">
            <button
              class="w-full text-left border rounded-md p-2 bg-white cursor-pointer"
              :class="selected?.id === c.id ? 'border-primary bg-primary/5' : 'border-slate-200'"
              type="button"
              @click="$emit('select', c)"
            >
              <span class="text-[11px] font-bold text-text-muted">#{{ index + 1 }}</span>
              <strong class="block text-xs text-text-main mt-0.5">{{ c.source }}</strong>
              <small class="text-[10.5px] text-text-muted">
                第 {{ (c.chunkIndex ?? c.chunk_index) + 1 }} 段
                <template v-if="c.rerank_score != null"> · 重排 {{ fmt(c.rerank_score) }}</template>
                · 相似度 {{ fmt(c.similarity) }}
              </small>
            </button>
          </li>
        </ol>
        <p v-else class="m-0 text-xs text-text-muted">无结果</p>
      </article>
    </div>

    <aside v-if="selected" class="border border-border-main rounded-lg p-3 bg-slate-50/70">
      <header class="flex justify-between gap-3 mb-2">
        <div>
          <p class="m-0 text-[10px] font-extrabold text-primary uppercase">命中内容</p>
          <h4 class="m-0 text-xs font-bold text-text-main">{{ selected.source }}</h4>
        </div>
        <span class="text-[11px] text-text-muted">第 {{ (selected.chunkIndex ?? selected.chunk_index) + 1 }} 段</span>
      </header>
      <pre class="m-0 whitespace-pre-wrap text-xs text-text-secondary font-sans">{{ selected.content }}</pre>
    </aside>
  </section>

  <section v-else class="border border-dashed border-border-main rounded-xl p-10 flex flex-col items-center justify-center gap-2 text-text-muted">
    <SearchIcon :size="22" />
    <p class="m-0 text-sm font-bold text-text-secondary">输入一个问题后运行测试</p>
    <span class="text-xs">这里会展示向量召回、重排结果和最终用于回答的片段。</span>
  </section>
</template>

<script setup lang="ts">
import { SearchIcon } from 'lucide-vue-next'
import type { KnowledgeSearchChunk, KnowledgeSearchResult } from '@/types'

defineProps<{
  result: KnowledgeSearchResult | null
  stage1: KnowledgeSearchChunk[]
  stage2: KnowledgeSearchChunk[]
  selected: KnowledgeSearchChunk | null
  expectedAnswer: string
}>()

defineEmits<{
  (e: 'select', chunk: KnowledgeSearchChunk): void
}>()

function fmt(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '-'
  return value.toFixed(3)
}
</script>
