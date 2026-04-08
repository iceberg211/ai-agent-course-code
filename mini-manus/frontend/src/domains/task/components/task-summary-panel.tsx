import type { LiveRunFeed, RunSummary } from '@/domains/run/types/run.types'
import type { TaskRevision, TaskSummary } from '@/domains/task/types/task.types'
import { Button } from '@/shared/ui/button'
import { PanelSection } from '@/shared/ui/panel-section'
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

  return (
    <PanelSection
      title="当前任务"
      subtitle={task.title}
      aside={
        <div className="summary-toolbar">
          <StatusBadge status={task.status} />
          <Button variant="ghost" onClick={onOpenEdit}>
            编辑
          </Button>
          <Button variant="secondary" onClick={onRetry} disabled={isRetrying}>
            {isRetrying ? '重试中...' : '重试'}
          </Button>
          <Button variant="danger" onClick={onCancel} disabled={isCancelling}>
            {isCancelling ? '取消中...' : '取消'}
          </Button>
        </div>
      }
    >
      <div className="summary-grid">
        <label className="summary-field">
          <span>Revision</span>
          <select
            value={selectedRevisionId ?? ''}
            onChange={(event) => onSelectRevision(event.target.value)}
          >
            {!revisions.length ? <option value="">暂无 Revision</option> : null}
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                v{revision.version} · {formatDateTime(revision.createdAt)}
              </option>
            ))}
          </select>
        </label>

        <label className="summary-field">
          <span>Run</span>
          <select
            value={selectedRunId ?? ''}
            onChange={(event) => onSelectRun(event.target.value)}
          >
            {!runs.length ? <option value="">暂无 Run</option> : null}
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                #{run.runNumber} · {run.status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="summary-note">
        <p className="summary-note__label">任务描述</p>
        <p>{revisionInput}</p>
      </div>

      {liveRunFeed ? (
        <div className="summary-live">
          <div className="summary-live__header">
            <div>
              <p className="summary-live__eyebrow">实时执行反馈</p>
              <h3>{liveRunFeed.latestNarration ?? '正在等待新的执行反馈'}</h3>
            </div>
            <div className="summary-live__badges">
              <StatusBadge status={liveRunFeed.runStatus} />
              <span
                className={`summary-live__socket ${socketConnected ? 'summary-live__socket--online' : 'summary-live__socket--offline'}`}
              >
                {socketConnected ? '实时通道已连接' : '实时通道重连中'}
              </span>
            </div>
          </div>

          <div className="summary-live__meta">
            <span>
              {activeStep
                ? `当前步骤 · ${activeStep.description}`
                : '当前没有活跃步骤，等待下一条事件'}
            </span>
            <span>{formatDateTime(liveRunFeed.lastEventAt ?? liveRunFeed.startedAt)}</span>
            {activeStep ? (
              <span>{formatDuration(activeStep.startedAt, activeStep.completedAt)}</span>
            ) : null}
          </div>

          {activeStep?.progressMessages.length ? (
            <ul className="summary-live__progress">
              {activeStep.progressMessages.map((message, index) => (
                <li key={`${activeStep.stepRunId}-summary-progress-${index}`}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </PanelSection>
  )
}
