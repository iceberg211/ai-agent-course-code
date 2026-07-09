<template>
  <ol class="list-none m-0 p-0 flex flex-col gap-3.5">
    <li
      v-for="task in tasks"
      :key="task.id"
      class="border border-border-main rounded-xl p-4 bg-white flex flex-col gap-2.5 text-left"
    >
      <header class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <strong class="block text-[13px] text-text-main">{{ task.title }}</strong>
          <span v-if="task.subtitle" class="block text-[10.5px] text-text-muted font-mono mt-0.5">
            {{ task.subtitle }}
          </span>
        </div>
        <StatusBadge :label="task.statusLabel" :status="task.status" />
      </header>

      <div v-if="task.meta?.length" class="grid grid-cols-2 gap-1.5 text-[11.5px] text-text-muted">
        <span v-for="item in task.meta" :key="item">{{ item }}</span>
      </div>

      <p v-if="task.error" class="m-0 p-2 px-2.5 rounded-lg bg-red-50 text-red-700 text-[11.5px]">
        {{ task.error }}
      </p>

      <ol v-if="task.steps?.length" class="list-none m-0 p-0 flex flex-col gap-2">
        <li
          v-for="step in task.steps"
          :key="`${task.id}-${step.key}`"
          class="grid grid-cols-[12px_1fr_auto_auto] gap-2 items-center text-[11.5px] text-text-secondary"
        >
          <span class="w-2 h-2 rounded-full" :class="stepDotClass(step.status)" />
          <strong class="font-semibold">{{ step.label }}</strong>
          <small class="text-text-muted">{{ step.statusLabel }}</small>
          <em class="not-italic text-text-muted text-[10.5px]">{{ step.duration || '' }}</em>
          <p
            v-if="step.error"
            class="col-span-full m-0 p-2 rounded-lg bg-red-50 text-red-700 text-[11px]"
          >
            {{ step.error }}
          </p>
        </li>
      </ol>
    </li>
  </ol>
</template>

<script setup lang="ts">
import StatusBadge from '@/components/common/StatusBadge.vue'

export interface TimelineStep {
  key: string
  label: string
  status?: string
  statusLabel?: string
  duration?: string
  error?: string | null
}

export interface TimelineTask {
  id: string
  title: string
  subtitle?: string
  status?: string
  statusLabel: string
  meta?: string[]
  error?: string | null
  steps?: TimelineStep[]
}

defineProps<{
  tasks: TimelineTask[]
}>()

function stepDotClass(status?: string) {
  if (status === 'completed') return 'bg-emerald-500'
  if (status === 'failed') return 'bg-red-500'
  if (status === 'running' || status === 'pending') return 'bg-amber-500'
  return 'bg-slate-400'
}
</script>
