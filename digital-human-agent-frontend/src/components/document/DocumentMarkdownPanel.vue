<template>
  <div class="flex flex-col min-h-[240px]">
    <LoadingSkeleton v-if="loading" :rows="3" :row-height="80" label="读取 Markdown" />
    <EmptyState v-else-if="!markdown" title="解析产物暂时为空" />
    <div v-else class="bg-slate-50 border border-border-main rounded-lg p-4 overflow-auto">
      <pre class="m-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-secondary font-sans">{{ markdown }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import EmptyState from '@/components/common/EmptyState.vue'
import LoadingSkeleton from '@/components/common/LoadingSkeleton.vue'

defineProps<{
  markdown: string
  loading: boolean
}>()
</script>
