<template>
  <article class="border border-slate-200 rounded-xl p-4 bg-slate-50/50 flex flex-col gap-3 min-h-[280px]">
    <h4 class="m-0 text-xs font-bold text-text-main">{{ title }}</h4>
    <div v-if="loading" class="animate-pulse flex flex-col gap-3 py-6">
      <div class="h-4 bg-slate-200 rounded" />
      <div class="h-4 bg-slate-200 rounded w-2/3" />
      <div class="h-24 bg-slate-200 rounded" />
    </div>
    <div v-else-if="!result" class="flex-1 flex items-center justify-center text-text-muted text-xs py-8">
      等待执行
    </div>
    <div v-else class="flex flex-col gap-3">
      <div class="grid grid-cols-2 gap-2">
        <div class="p-2 rounded-lg bg-white border border-slate-200/60">
          <span class="block text-[10px] text-text-muted">结果数</span>
          <strong class="text-sm font-black text-text-main">{{ result.chunks?.length || 0 }} chunks</strong>
        </div>
        <div class="p-2 rounded-lg bg-white border border-slate-200/60">
          <span class="block text-[10px] text-text-muted">时延</span>
          <strong class="text-sm font-black text-text-main">{{ result.latencyMs }}ms</strong>
        </div>
      </div>
      <div
        v-if="result.chunks?.[0]"
        class="p-3 border border-slate-200/50 rounded-lg bg-white text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap max-h-60 overflow-y-auto"
      >
        <div class="flex justify-between gap-2 mb-2 text-[10px] text-text-muted">
          <span>
            Score:
            <strong class="text-text-main">
              {{ result.chunks[0].rerankScore?.toFixed?.(4) || result.chunks[0].rerank_score?.toFixed?.(4) || result.chunks[0].score?.toFixed?.(4) || result.chunks[0].similarity?.toFixed?.(4) || '-' }}
            </strong>
          </span>
          <span>Source: {{ result.chunks[0].source || 'hybrid' }}</span>
        </div>
        {{ result.chunks[0].content }}
      </div>
      <p v-else class="m-0 text-xs text-text-muted">无命中结果</p>
    </div>
  </article>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  loading: boolean
  result: any
}>()
</script>
