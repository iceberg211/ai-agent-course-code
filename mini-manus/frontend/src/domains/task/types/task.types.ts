import type { RunDetail, RunSummary } from '@/domains/run/types/run.types'
import type { TaskStatus } from '@/shared/types/status'

export interface TaskSummary {
  id: string
  title: string
  status: TaskStatus
  currentRevisionId: string | null
  currentRunId: string | null
  createdAt: string
  updatedAt: string
  latestSummary: string | null
}

export interface TaskRevision {
  id: string
  taskId: string
  version: number
  input: string
  createdAt: string
}

export interface TaskDetail {
  task: TaskSummary
  revisions: TaskRevision[]
  runs: RunSummary[]
  currentRun: RunDetail | null
}
