import { useEffect, useRef } from 'react'
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

  // 跟踪 task.currentRunId 的上一个值，用于检测是否有新 run 启动
  const prevCurrentRunIdRef = useRef<string | null | undefined>(undefined)

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

    const currentRunId = taskDetail.task.currentRunId
    const prevCurrentRunId = prevCurrentRunIdRef.current
    // 初始值为 undefined 表示首次渲染，不算"切换"；否则视为新 run 启动
    const currentRunIdChanged =
      prevCurrentRunId !== undefined && prevCurrentRunId !== currentRunId
    prevCurrentRunIdRef.current = currentRunId

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
      // task.currentRunId 变化（新 run 启动）→ 自动跳到最新 run
      (currentRunIdChanged && currentRunId && runsForRevision.some((run) => run.id === currentRunId))
        ? currentRunId
        : selectedRunId && runsForRevision.some((run) => run.id === selectedRunId)
        ? selectedRunId
        : (runsForRevision[0]?.id ??
          (nextRevisionId === taskDetail.task.currentRevisionId
            ? (currentRunId ?? taskDetail.currentRun?.id ?? null)
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
