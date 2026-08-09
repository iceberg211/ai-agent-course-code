<template>
  <span
    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10.5px] font-bold whitespace-nowrap"
    :class="toneClass"
  >
    <span
      v-if="dot"
      class="w-1.5 h-1.5 rounded-full shrink-0"
      :class="dotClass"
    />
    <slot>{{ label }}</slot>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type BadgeTone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary'

const props = withDefaults(
  defineProps<{
    label?: string
    tone?: BadgeTone
    status?: string
    dot?: boolean
  }>(),
  {
    label: '',
    tone: undefined,
    status: '',
    dot: false,
  },
)

const resolvedTone = computed<BadgeTone>(() => {
  if (props.tone) return props.tone
  const status = (props.status || '').toLowerCase()
  if (['completed', 'ready', 'ok', 'success', 'indexed', 'passed'].includes(status)) return 'success'
  if (['failed', 'error', 'rejected'].includes(status)) return 'error'
  if (['pending', 'processing', 'running', 'training', 'queued'].includes(status)) return 'warning'
  if (['skipped', 'closed', 'archived'].includes(status)) return 'neutral'
  return 'info'
})

const toneClass = computed(() => {
  switch (resolvedTone.value) {
    case 'success':
      return 'bg-emerald-50 text-emerald-700'
    case 'warning':
      return 'bg-amber-50 text-amber-700'
    case 'error':
      return 'bg-red-50 text-red-700'
    case 'primary':
      return 'bg-primary-bg text-primary'
    case 'neutral':
      return 'bg-slate-100 text-slate-700'
    default:
      return 'bg-blue-50 text-blue-700'
  }
})

const dotClass = computed(() => {
  switch (resolvedTone.value) {
    case 'success':
      return 'bg-emerald-500'
    case 'warning':
      return 'bg-amber-500'
    case 'error':
      return 'bg-red-500'
    case 'primary':
      return 'bg-primary'
    default:
      return 'bg-slate-400'
  }
})
</script>
