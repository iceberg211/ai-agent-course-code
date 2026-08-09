<template>
  <div class="flex flex-col gap-3.5 text-left">
    <LoadingSkeleton v-if="loading" :rows="2" :row-height="120" label="读取处理任务" />
    <EmptyState v-else-if="tasks.length === 0" title="该文档暂无处理任务记录" />
    <TaskTimeline v-else :tasks="timelineTasks" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import EmptyState from '@/components/common/EmptyState.vue'
import LoadingSkeleton from '@/components/common/LoadingSkeleton.vue'
import TaskTimeline, { type TimelineTask } from '@/components/common/TaskTimeline.vue'
import type { DocumentTaskItem } from '@/types'
import {
  formatDateTime,
  formatDuration,
  stageLabelOf,
  statusLabelOf,
  taskStepLabelOf,
  taskTypeLabelOf,
} from '@/components/document/documentDetail.utils'

const props = defineProps<{
  tasks: DocumentTaskItem[]
  loading: boolean
}>()

const timelineTasks = computed<TimelineTask[]>(() =>
  props.tasks.map((task) => ({
    id: task.id,
    title: taskTypeLabelOf(task.taskType || task.task_type),
    subtitle: `ID: ${task.id}`,
    status: task.status,
    statusLabel: statusLabelOf(task.status),
    meta: [
      `阶段：${stageLabelOf(task.stage)}`,
      `进度：${task.progress ?? 0}%`,
      `开始：${formatDateTime(task.startedAt || task.started_at || task.createdAt || task.created_at)}`,
      `结束：${formatDateTime(task.finishedAt || task.finished_at)}`,
    ],
    error: task.error,
    steps: (task.steps || []).map((step) => ({
      key: step.step,
      label: taskStepLabelOf(step.step),
      status: step.status,
      statusLabel: statusLabelOf(step.status),
      duration: formatDuration(step.startedAt || step.started_at, step.finishedAt || step.finished_at),
      error: step.error,
    })),
  })),
)
</script>
