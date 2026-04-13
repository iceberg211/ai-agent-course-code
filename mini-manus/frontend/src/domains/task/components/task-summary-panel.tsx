import type { LiveRunFeed, RunSummary } from '@/domains/run/types/run.types'
import type { TaskRevision, TaskSummary } from '@/domains/task/types/task.types'
import { Button } from '@/shared/ui/button'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatDateTime, formatDuration } from '@/shared/utils/date'

interface TaskSummaryPanelProps {
  isCancelling: boolean
  isRetrying: boolean
  liveRunFeed: LiveRunFeed | null
  onCancel: () => void
  onOpenEdit: () => void
  onRetry: () => void
  onSelectRevision: (revisionId: string) => void
  onSelectRun: (runId: string) => void
  revisionInput: string
  revisions: TaskRevision[]
  runs: RunSummary[]
  selectedRevisionId: string | null
  selectedRunId: string | null
  socketConnected: boolean
  task: TaskSummary
}

const RUN_STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  awaiting_approval: '待审批',
}

export function TaskSummaryPanel({
  isCancelling,
  isRetrying,
  liveRunFeed,
  onCancel,
  onOpenEdit,
  onRetry,
  onSelectRevision,
  onSelectRun,
  revisionInput,
  revisions,
  runs,
  selectedRevisionId,
  selectedRunId,
  socketConnected,
  task,
}: TaskSummaryPanelProps) {
  const activeStep =
    liveRunFeed?.activeStepRunId && liveRunFeed.steps[liveRunFeed.activeStepRunId]
      ? liveRunFeed.steps[liveRunFeed.activeStepRunId]
      : null

  const isRunning = task.status === 'running'

  return (
    <section className="task-header">
      {/* 顶部：标题 + 状态 + 操作 */}
      <div className="task-header__top">
        <div className="task-header__title-block">
          <StatusBadge status={task.status} />
          <h2 className="task-header__title">{task.title}</h2>
        </div>

        <div className="task-header__actions">
          <Button variant="ghost" onClick={onOpenEdit}>
            编辑
          </Button>
          <Button
            variant="secondary"
            onClick={onRetry}
            disabled={isRetrying}
          >
            {isRetrying ? '重试中…' : '重试'}
          </Button>
          {isRunning && (
            <Button
              variant="danger"
              onClick={onCancel}
              disabled={isCancelling}
            >
              {isCancelling ? '停止中…' : '停止'}
            </Button>
          )}
        </div>
      </div>

      {/* 任务描述 */}
      <p className="task-header__desc">{revisionInput}</p>

      {/* 底部元信息行：版本选择 + 执行记录选择 + 实时状态 */}
      <div className="task-header__meta">
        <div className="task-header__selectors">
          <label className="task-header__selector-label">
            <span>版本</span>
            <select
              value={selectedRevisionId ?? ''}
              onChange={(e) => onSelectRevision(e.target.value)}
            >
              {!revisions.length ? <option value="">暂无版本</option> : null}
              {revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  v{r.version} · {formatDateTime(r.createdAt)}
                </option>
              ))}
            </select>
          </label>

          <label className="task-header__selector-label">
            <span>执行记录</span>
            <select
              value={selectedRunId ?? ''}
              onChange={(e) => onSelectRun(e.target.value)}
            >
              {!runs.length ? <option value="">暂无执行记录</option> : null}
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  第 {run.runNumber} 次 · {RUN_STATUS_LABELS[run.status] ?? run.status}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 实时进度条 — 仅执行中显示 */}
        {liveRunFeed && isRunning && (
          <div className="task-header__live">
            <span
              className={`task-header__dot ${socketConnected ? 'task-header__dot--online' : 'task-header__dot--offline'}`}
            />
            <span className="task-header__live-text">
              {activeStep
                ? activeStep.description
                : liveRunFeed.latestNarration ?? '准备中…'}
            </span>
            {activeStep && (
              <span className="task-header__live-duration">
                {formatDuration(activeStep.startedAt, activeStep.completedAt)}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
