<template>
  <div
    class="flex flex-col items-center justify-center gap-3 p-16 text-center bg-white/55 rounded-xl border border-slate-200/60 min-h-[240px]"
    role="alert"
  >
    <AlertCircleIcon :size="32" class="text-error" />
    <p class="m-0 text-sm font-bold text-text-secondary">{{ title }}</p>
    <p v-if="description" class="m-0 max-w-md text-xs text-text-muted leading-relaxed">
      {{ description }}
    </p>
    <button
      v-if="retryLabel"
      class="mt-1 px-4 py-2 bg-transparent text-text-secondary border border-border-main rounded-lg text-[12.5px] font-semibold cursor-pointer transition-all duration-200 hover:bg-primary/5 hover:text-primary"
      type="button"
      @click="$emit('retry')"
    >
      {{ retryLabel }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { AlertCircleIcon } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    title?: string
    description?: string
    retryLabel?: string
  }>(),
  {
    title: '加载失败',
    description: '请检查后端服务状态后重试。',
    retryLabel: '重新加载',
  },
)

defineEmits<{
  (e: 'retry'): void
}>()
</script>
