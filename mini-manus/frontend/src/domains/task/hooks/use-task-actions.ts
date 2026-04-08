import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  cancelTask,
  createTask,
  editTask,
  retryTask,
} from '@/core/api/task.api'
import { queryKeys } from '@/core/api/query-keys'
import { useTaskCenterPanels } from '@/domains/task/hooks/use-task-center-panels'
import { useTaskSelectionActions } from '@/domains/task/hooks/use-task-selection-actions'

export function useTaskActions() {
  const queryClient = useQueryClient()
  const selectionActions = useTaskSelectionActions()
  const panels = useTaskCenterPanels()

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
    mutationFn: createTask,
    onSuccess: async (task) => {
      selectionActions.selectTask(task.id)
      await invalidateTaskState(task.id)
    },
  })

  const cancelTaskMutation = useMutation({
    mutationFn: cancelTask,
    onSuccess: async (_, taskId) => {
      await invalidateTaskState(taskId)
    },
  })

  const retryTaskMutation = useMutation({
    mutationFn: retryTask,
    onSuccess: async (_, taskId) => {
      selectionActions.selectTask(taskId)
      await invalidateTaskState(taskId)
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
    cancelTaskMutation,
    retryTaskMutation,
    editTaskMutation,
  }
}
