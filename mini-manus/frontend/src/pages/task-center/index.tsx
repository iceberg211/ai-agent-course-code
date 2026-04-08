import { useMemo } from 'react'
import '@/pages/task-center/task-center.css'
import { ArtifactSection } from '@/domains/artifact/components/artifact-section'
import { useArtifactSelectionSync } from '@/domains/artifact/hooks/use-artifact-selection-sync'
import { useSelectedArtifact } from '@/domains/artifact/hooks/use-selected-artifact'
import { PlanSection } from '@/domains/plan/components/plan-section'
import { TimelineSection } from '@/domains/run/components/timeline-section'
import { useRunDetailQuery } from '@/domains/run/hooks/use-run-detail-query'
import { useSelectedRun } from '@/domains/run/hooks/use-selected-run'
import { TaskEditModal } from '@/domains/task/components/task-edit-modal'
import { TaskSidebar } from '@/domains/task/components/task-sidebar'
import { TaskSummaryPanel } from '@/domains/task/components/task-summary-panel'
import { useSelectedRevision } from '@/domains/task/hooks/use-selected-revision'
import { useTaskActions } from '@/domains/task/hooks/use-task-actions'
import { useTaskCenterPanels } from '@/domains/task/hooks/use-task-center-panels'
import { useTaskDetailQuery } from '@/domains/task/hooks/use-task-detail-query'
import { useTaskListQuery } from '@/domains/task/hooks/use-task-list-query'
import { useTaskSelectionActions } from '@/domains/task/hooks/use-task-selection-actions'
import { useTaskSelectionSync } from '@/domains/task/hooks/use-task-selection-sync'
import { useSelectedTask } from '@/domains/task/hooks/use-selected-task'
import { useTaskSocketSync } from '@/domains/task/hooks/use-task-socket-sync'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/utils/cn'

export function TaskCenterPage() {
  const panels = useTaskCenterPanels()
  const selectionActions = useTaskSelectionActions()
  const taskActions = useTaskActions()
  const { selectedTaskId } = useSelectedTask()
  const { selectedRevisionId } = useSelectedRevision()
  const { selectedRunId } = useSelectedRun()
  const { selectedArtifactId } = useSelectedArtifact()
  const taskListQuery = useTaskListQuery()
  const taskDetailQuery = useTaskDetailQuery(selectedTaskId)

  useTaskSelectionSync(taskListQuery.data, taskDetailQuery.data)
  const { liveRunFeed, socketConnected } = useTaskSocketSync(selectedTaskId, selectedRunId)

  const runDetailQuery = useRunDetailQuery(
    selectedTaskId,
    selectedRunId,
    taskDetailQuery.data?.currentRun ?? null,
  )

  useArtifactSelectionSync(runDetailQuery.runDetail?.artifacts)

  const selectedRevision = useMemo(
    () =>
      taskDetailQuery.data?.revisions.find((revision) => revision.id === selectedRevisionId) ??
      taskDetailQuery.data?.revisions[0] ??
      null,
    [selectedRevisionId, taskDetailQuery.data?.revisions],
  )

  const revisionRuns = useMemo(() => {
    if (!taskDetailQuery.data || !selectedRevision) return []

    return taskDetailQuery.data.runs
      .filter((run) => run.revisionId === selectedRevision.id)
      .sort((left, right) => right.runNumber - left.runNumber)
  }, [selectedRevision, taskDetailQuery.data])

  const currentRun = runDetailQuery.runDetail
  const hasTasks = (taskListQuery.data?.length ?? 0) > 0
  const currentRevisionInput =
    taskDetailQuery.data?.revisions.find(
      (revision) => revision.id === taskDetailQuery.data.task.currentRevisionId,
    )?.input ?? ''

  return (
    <div className="task-center-shell">
      <div
        className={cn('task-center-shell__scrim', panels.isSidebarOpen && 'task-center-shell__scrim--visible')}
        onClick={panels.closeSidebar}
      />

      <TaskSidebar
        isOpen={panels.isSidebarOpen}
        isCreating={taskActions.createTaskMutation.isPending}
        onClose={panels.closeSidebar}
        onCreateTask={(input) => taskActions.createTaskMutation.mutateAsync(input)}
        onSelectTask={selectionActions.selectTask}
        onDeleteTask={(id) => taskActions.deleteTaskMutation.mutate(id)}
        selectedTaskId={selectedTaskId}
        tasks={taskListQuery.data ?? []}
      />

      <main className="task-center-main">
        <header className="task-center-topbar">
          <div className="task-center-topbar__actions">
            <Button variant="ghost" onClick={panels.toggleSidebar}>
              任务列表
            </Button>
            {taskDetailQuery.data?.task ? <StatusBadge status={taskDetailQuery.data.task.status} /> : null}
          </div>
          <p className="task-center-topbar__meta">
            {hasTasks ? `共 ${taskListQuery.data?.length ?? 0} 个任务` : '从左侧创建第一个任务'}
          </p>
        </header>

        {!hasTasks ? (
          <section className="task-center-empty">
            <EmptyState title="还没有任务" description="先在左侧输入任务描述，系统会自动开始规划和执行。" />
          </section>
        ) : !taskDetailQuery.data ? (
          <section className="task-center-empty">
            <EmptyState title="正在加载任务" description="任务详情会在几秒内同步出来。" />
          </section>
        ) : (
          <div className="task-center-grid">
            <TaskSummaryPanel
              isCancelling={taskActions.cancelTaskMutation.isPending}
              isRetrying={taskActions.retryTaskMutation.isPending}
              liveRunFeed={liveRunFeed}
              onCancel={() => {
                if (selectedTaskId) {
                  taskActions.cancelTaskMutation.mutate(selectedTaskId)
                }
              }}
              onOpenEdit={panels.openEditModal}
              onRetry={() => {
                if (selectedTaskId) {
                  taskActions.retryTaskMutation.mutate(selectedTaskId)
                }
              }}
              onSelectRevision={selectionActions.selectRevision}
              onSelectRun={selectionActions.selectRun}
              revisionInput={selectedRevision?.input ?? ''}
              revisions={taskDetailQuery.data.revisions}
              runs={revisionRuns}
              selectedRevisionId={selectedRevision?.id ?? null}
              selectedRunId={selectedRunId}
              socketConnected={socketConnected}
              task={taskDetailQuery.data.task}
            />

            <section className="task-center-grid__columns">
              <PlanSection
                liveRunFeed={liveRunFeed}
                plans={currentRun?.plans ?? []}
                stepRuns={currentRun?.stepRuns ?? []}
              />
              <TimelineSection
                liveRunFeed={liveRunFeed}
                plans={currentRun?.plans ?? []}
                stepRuns={currentRun?.stepRuns ?? []}
              />
            </section>

            <ArtifactSection
              artifacts={currentRun?.artifacts ?? []}
              onSelectArtifact={selectionActions.selectArtifact}
              selectedArtifactId={selectedArtifactId}
            />
          </div>
        )}
      </main>

      <TaskEditModal
        initialValue={currentRevisionInput}
        isOpen={panels.isEditModalOpen}
        isPending={taskActions.editTaskMutation.isPending}
        onClose={panels.closeEditModal}
        onSubmit={(input) =>
          selectedTaskId
            ? taskActions.editTaskMutation.mutateAsync({ input, taskId: selectedTaskId })
            : Promise.resolve()
        }
      />
    </div>
  )
}
