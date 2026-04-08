import { useEffect } from 'react'
import type { TaskDetail, TaskSummary } from '@/domains/task/types/task.types'
import { useSelectedRevision } from '@/domains/task/hooks/use-selected-revision'
import { useSelectedTask } from '@/domains/task/hooks/use-selected-task'
import { useSelectedRun } from '@/domains/run/hooks/use-selected-run'

export function useTaskSelectionSync(
  tasks: TaskSummary[] | undefined,
  taskDetail: TaskDetail | undefined,
) {
  const { selectedTaskId, setSelectedTaskId } = useSelectedTask()
  const { selectedRevisionId, setSelectedRevisionId } = useSelectedRevision()
  const { selectedRunId, setSelectedRunId } = useSelectedRun()

  useEffect(() => {
    if (!tasks?.length) return

    const hasCurrentTask = selectedTaskId
      ? tasks.some((task) => task.id === selectedTaskId)
      : false

    if (!hasCurrentTask) {
      setSelectedTaskId(tasks[0].id)
    }
  }, [selectedTaskId, setSelectedTaskId, tasks])

  useEffect(() => {
    if (!taskDetail) return

    const nextRevisionId =
      selectedRevisionId && taskDetail.revisions.some((revision) => revision.id === selectedRevisionId)
        ? selectedRevisionId
        : (taskDetail.task.currentRevisionId ?? taskDetail.revisions[0]?.id ?? null)

    if (nextRevisionId !== selectedRevisionId) {
      setSelectedRevisionId(nextRevisionId)
    }

    const runsForRevision = nextRevisionId
      ? taskDetail.runs.filter((run) => run.revisionId === nextRevisionId)
      : []

    const nextRunId =
      selectedRunId && runsForRevision.some((run) => run.id === selectedRunId)
        ? selectedRunId
        : (runsForRevision[0]?.id ??
          (nextRevisionId === taskDetail.task.currentRevisionId
            ? (taskDetail.task.currentRunId ?? taskDetail.currentRun?.id ?? null)
            : null))

    if (nextRunId !== selectedRunId) {
      setSelectedRunId(nextRunId)
    }
  }, [
    selectedRevisionId,
    selectedRunId,
    setSelectedRevisionId,
    setSelectedRunId,
    taskDetail,
  ])
}
