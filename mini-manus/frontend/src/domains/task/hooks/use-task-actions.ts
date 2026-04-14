import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  cancelTask,
  createTask,
  deleteTask,
  editTask,
  retryTask,
} from '@/core/api/task.api'
import { queryKeys } from '@/core/api/query-keys'
import { useTaskCenterPanels } from '@/domains/task/hooks/use-task-center-panels'
import { useTaskSelectionActions } from '@/domains/task/hooks/use-task-selection-actions'
import { useSelectedTask } from '@/domains/task/hooks/use-selected-task'

export function useTaskActions() {
  const queryClient = useQueryClient()
  const selectionActions = useTaskSelectionActions()
  const panels = useTaskCenterPanels()
  const { selectedTaskId } = useSelectedTask()

  const invalidateTaskState = useCallback(
    async (taskId: string) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.taskDetail(taskId) }),
      ])
    },
    [queryClient],
  )

  const createTaskMutation = useMutation({
    mutationFn: ({ input, approvalMode }: { input: string; approvalMode?: import('@/core/api/task.api').ApprovalMode }) =>
      createTask(input, approvalMode),
    onSuccess: async (task) => {
      panels.closeSidebar()
      // 先等任务列表刷新（包含新任务），再切换选中。
      // 若先 selectTask 再 invalidate，useTaskSelectionSync 会在列表还没有新任务时
      // 把 selectedTaskId 重置为 tasks[0]（旧任务）。
      await queryClient.refetchQueries({ queryKey: queryKeys.tasks() })
      selectionActions.selectTask(task.id)
    },
  })

  const deleteTaskMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: (_, taskId) => {
      // 如果删的是当前选中的任务，清除选中状态
      if (selectedTaskId === taskId) {
        selectionActions.selectTask(null)
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks() })
    },
  })

  const cancelTaskMutation = useMutation({
    mutationFn: cancelTask,
    // Bug 3 fix: 不在 onSuccess 里 invalidate
    // socket 事件 (run.cancelled) 会触发 invalidateSelectedTask
    // 立即刷新一次 detail 给用户反馈，不会造成重复因为 socket 可能延迟
    onSuccess: async (_, taskId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.taskDetail(taskId) })
    },
  })

  const retryTaskMutation = useMutation({
    mutationFn: retryTask,
    onSuccess: (_, taskId) => {
      // Bug 3 fix: retry 后不主动 invalidate
      // socket 的 run.started 事件会立即触发 invalidateSelectedTask
      // 只做导航，不做重复请求
      selectionActions.selectTask(taskId)
    },
  })

  const editTaskMutation = useMutation({
    mutationFn: ({ input, taskId }: { taskId: string; input: string }) =>
      editTask(taskId, input),
    onSuccess: async (revision, variables) => {
      selectionActions.selectTask(variables.taskId)
      selectionActions.selectRevision(revision.id)
      panels.closeEditModal()
      await invalidateTaskState(variables.taskId)
    },
  })

  return {
    createTaskMutation,
    deleteTaskMutation,
    cancelTaskMutation,
    retryTaskMutation,
    editTaskMutation,
  }
}
