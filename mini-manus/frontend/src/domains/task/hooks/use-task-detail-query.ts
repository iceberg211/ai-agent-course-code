import { useQuery } from '@tanstack/react-query'
import { fetchTaskDetail } from '@/core/api/task.api'
import { queryKeys } from '@/core/api/query-keys'

export function useTaskDetailQuery(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.taskDetail(taskId ?? 'empty'),
    queryFn: () => fetchTaskDetail(taskId!),
    enabled: Boolean(taskId),
  })
}
