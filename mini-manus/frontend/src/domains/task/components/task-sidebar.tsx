import type { ApprovalMode } from '@/core/api/task.api'
import type { TaskSummary } from '@/domains/task/types/task.types'
import { TaskCreateForm } from '@/domains/task/components/task-create-form'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/utils/cn'
import { formatRelativeTime } from '@/shared/utils/date'

interface TaskSidebarProps {
  isOpen: boolean
  isCreating: boolean
  onClose: () => void
  onCreateTask: (input: string, approvalMode: ApprovalMode) => Promise<unknown>
  onSelectTask: (taskId: string) => void
  onDeleteTask: (taskId: string) => void
  selectedTaskId: string | null
  tasks: TaskSummary[]
}

export function TaskSidebar({
  isCreating,
  isOpen,
  onClose,
  onCreateTask,
  onSelectTask,
  onDeleteTask,
  selectedTaskId,
  tasks,
}: TaskSidebarProps) {
  return (
    <aside className={cn('task-sidebar', isOpen && 'task-sidebar--open')}>
      <div className="task-sidebar__inner">
        <header className="task-sidebar__header">
          <div>
            <p className="task-sidebar__eyebrow">任务中心</p>
            <h1>Mini-Manus</h1>
          </div>
          <button className="task-sidebar__close" onClick={onClose} aria-label="关闭任务列表">
            关闭
          </button>
        </header>

        <TaskCreateForm isPending={isCreating} onCreate={onCreateTask} />

        <div className="task-sidebar__list">
          {tasks.map((task) => {
            const isActive = task.id === selectedTaskId

            return (
              <div
                key={task.id}
                className={cn('task-sidebar__item', isActive && 'task-sidebar__item--active')}
              >
                <button
                  className="task-sidebar__item-body"
                  onClick={() => onSelectTask(task.id)}
                >
                  <div className="task-sidebar__item-top">
                    <span className={cn('task-dot', `task-dot--${task.status}`)} />
                    <span className="task-sidebar__item-title">{task.title}</span>
                  </div>
                  {/* 侧边栏摘要：展示最近一次 run 的 summary */}
                  {task.latestSummary && (
                    <p className="task-sidebar__item-summary">{task.latestSummary}</p>
                  )}
                  <div className="task-sidebar__item-meta">
                    <span>{formatRelativeTime(task.updatedAt)}</span>
                    <StatusBadge status={task.status} />
                  </div>
                </button>

                <button
                  className="task-sidebar__item-delete"
                  aria-label="删除任务"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`确认删除「${task.title}」？此操作不可撤销。`)) {
                      onDeleteTask(task.id)
                    }
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
