export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type RunStatus = TaskStatus
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type ArtifactType = 'markdown' | 'json' | 'file' | 'code' | 'diagram'
export type ExecutorType = 'tool' | 'skill'

export const statusLabels: Record<TaskStatus | StepStatus, string> = {
  pending: '等待中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  skipped: '已跳过',
}
