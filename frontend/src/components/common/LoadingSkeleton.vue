<template>
  <div class="flex flex-col gap-4" :aria-label="label" role="status">
    <div
      v-for="i in rows"
      :key="i"
      class="animate-pulse bg-slate-200/70 rounded-xl"
      :style="{ height: `${rowHeight}px` }"
    />
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    rows?: number
    rowHeight?: number
    label?: string
  }>(),
  {
    rows: 3,
    rowHeight: 96,
    label: '加载中',
  },
)
</script>
