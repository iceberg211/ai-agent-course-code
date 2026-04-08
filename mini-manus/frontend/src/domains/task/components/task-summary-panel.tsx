import type { RunSummary } from '@/domains/run/types/run.types'
import type { TaskRevision, TaskSummary } from '@/domains/task/types/task.types'
import { Button } from '@/shared/ui/button'
import { PanelSection } from '@/shared/ui/panel-section'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatDateTime } from '@/shared/utils/date'

interface TaskSummaryPanelProps {
  isCancelling: boolean
  isRetrying: boolean
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
  task: TaskSummary
}

export function TaskSummaryPanel({
  isCancelling,
  isRetrying,
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
  task,
}: TaskSummaryPanelProps) {
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
    </PanelSection>
  )
}
