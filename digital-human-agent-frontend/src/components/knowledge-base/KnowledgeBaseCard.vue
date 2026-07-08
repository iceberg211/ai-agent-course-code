<template>
  <button class="flex flex-col gap-2.5 w-full p-5.5 border border-slate-200/60 rounded-2xl bg-white/75 backdrop-blur-md text-left cursor-pointer transition-all duration-250 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-card-hover shadow-card outline-none focus-visible:ring-3 focus-visible:ring-border-focus" type="button" @click="$emit('open', kb.id)">
    <div class="flex items-center gap-2">
      <BookOpenIcon :size="16" class="text-primary shrink-0" aria-hidden="true" />
      <h3 class="m-0 text-sm font-extrabold text-text-main tracking-tight line-clamp-1">{{ kb.name }}</h3>
    </div>
    <p v-if="kb.description" class="m-0 text-xs text-text-secondary leading-relaxed line-clamp-2 min-h-[38px]">{{ kb.description }}</p>
    <div v-else class="min-h-[38px] text-xs text-text-muted/60 italic">暂无该知识库的相关简介说明。</div>
    <footer class="flex gap-2 flex-wrap items-center text-[10px] text-text-muted mt-1.5">
      <span class="font-mono bg-slate-50/80 px-2 py-0.75 rounded-md border border-slate-200/60">threshold {{ kb.retrievalConfig.threshold }}</span>
      <span class="font-mono bg-slate-50/80 px-2 py-0.75 rounded-md border border-slate-200/60">topK {{ kb.retrievalConfig.finalTopK }}</span>
      <span v-if="kb.retrievalConfig.rerank" class="px-2 py-0.75 rounded-md bg-blue-50 border border-blue-200/40 text-primary font-bold">rerank</span>
    </footer>
  </button>
</template>

<script setup lang="ts">
import { BookOpenIcon } from 'lucide-vue-next'
import type { KnowledgeBase } from '@/types'

defineProps<{ kb: KnowledgeBase }>()
defineEmits<{ (e: 'open', kbId: string): void }>()
</script>

<style scoped>
/* 组件已全量使用 Tailwind CSS v4 适配，无需 scoped 样式 */
</style>
