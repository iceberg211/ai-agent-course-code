import type { RunStatus, StepStatus, TaskStatus } from '@/shared/types/status'
import { statusLabels } from '@/shared/types/status'
import { cn } from '@/shared/utils/cn'

interface StatusBadgeProps {
  status: RunStatus | StepStatus | TaskStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={cn('status-badge', `status-badge--${status}`)}>
      {statusLabels[status]}
    </span>
  )
}
