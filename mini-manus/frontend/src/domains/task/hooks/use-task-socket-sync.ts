import { useEffect, useEffectEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/core/api/query-keys'
import { getTaskSocket } from '@/core/socket/socket-client'
import { TASK_EVENTS, TASK_ROOM_EVENTS } from '@/core/socket/task-events'
import type { TaskDetail } from '@/domains/task/types/task.types'

interface TaskEventPayload {
  taskId?: string
  runId?: string
}

export function useTaskSocketSync(
  selectedTaskId: string | null,
  selectedRunId: string | null,
) {
  const queryClient = useQueryClient()

  const invalidateSelectedTask = useEffectEvent((payload?: TaskEventPayload) => {
    if (!selectedTaskId) return

    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks() })
    void queryClient.invalidateQueries({
      queryKey: queryKeys.taskDetail(selectedTaskId),
    })

    if (payload?.runId && payload.runId === selectedRunId) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runDetail(selectedTaskId, payload.runId),
      })
    }
  })

  const handleSnapshot = useEffectEvent((snapshot: TaskDetail) => {
    if (!selectedTaskId || snapshot.task.id !== selectedTaskId) return

    queryClient.setQueryData(queryKeys.taskDetail(selectedTaskId), snapshot)

    if (snapshot.currentRun) {
      queryClient.setQueryData(
        queryKeys.runDetail(selectedTaskId, snapshot.currentRun.id),
        snapshot.currentRun,
      )
    }
  })

  const handleTaskCreated = useEffectEvent(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks() })
  })

  useEffect(() => {
    const socket = getTaskSocket()
    socket.connect()

    const onTaskCreated = () => handleTaskCreated()
    const onTaskSnapshot = (snapshot: TaskDetail) => handleSnapshot(snapshot)

    socket.on(TASK_EVENTS.taskCreated, onTaskCreated)
    socket.on(TASK_EVENTS.taskSnapshot, onTaskSnapshot)

    for (const eventName of TASK_ROOM_EVENTS) {
      socket.on(eventName, invalidateSelectedTask)
    }

    return () => {
      socket.off(TASK_EVENTS.taskCreated, onTaskCreated)
      socket.off(TASK_EVENTS.taskSnapshot, onTaskSnapshot)

      for (const eventName of TASK_ROOM_EVENTS) {
        socket.off(eventName, invalidateSelectedTask)
      }

      socket.disconnect()
    }
  }, [])

  useEffect(() => {
    const socket = getTaskSocket()

    if (!selectedTaskId) return

    socket.emit('join:task', { taskId: selectedTaskId })

    return () => {
      socket.emit('leave:task', { taskId: selectedTaskId })
    }
  }, [selectedTaskId])
}
