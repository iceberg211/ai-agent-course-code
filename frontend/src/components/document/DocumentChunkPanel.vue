<template>
  <div>
    <LoadingSkeleton v-if="loading" :rows="3" :row-height="100" label="查询实体关联切片" />
    <EmptyState v-else-if="chunks.length === 0" title="该文档尚未拆分切片" />
    <ul v-else class="list-none m-0 p-0 flex flex-col gap-3">
      <li
        v-for="c in chunks"
        :key="c.id"
        class="border border-border-main rounded-xl p-4 bg-white flex flex-col gap-2.5"
        :class="{ 'opacity-60': !c.enabled }"
      >
        <header class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <span class="text-[13px] font-bold text-primary">§ {{ c.chunkIndex + 1 }}</span>
            <span class="text-[11.5px] text-text-muted">{{ c.content.length }} 字</span>
          </div>
          <label v-if="canEdit" class="inline-flex items-center gap-1.5 text-xs font-bold text-text-secondary cursor-pointer">
            <input type="checkbox" :checked="c.enabled" @change="$emit('toggle', c)" />
            <span>{{ c.enabled ? '已启用' : '已禁用' }}</span>
          </label>
        </header>
        <pre class="m-0 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-text-secondary bg-slate-50 p-3 rounded-md font-sans">{{ c.content }}</pre>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import EmptyState from '@/components/common/EmptyState.vue'
import LoadingSkeleton from '@/components/common/LoadingSkeleton.vue'
import type { KnowledgeChunk } from '@/types'

defineProps<{
  chunks: KnowledgeChunk[]
  loading: boolean
  canEdit: boolean
}>()

defineEmits<{
  (e: 'toggle', chunk: KnowledgeChunk): void
}>()
</script>
