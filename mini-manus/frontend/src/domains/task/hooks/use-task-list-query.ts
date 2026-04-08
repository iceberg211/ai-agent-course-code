import { useQuery } from '@tanstack/react-query'
import { fetchTasks } from '@/core/api/task.api'
import { queryKeys } from '@/core/api/query-keys'

export function useTaskListQuery() {
  return useQuery({
    queryKey: queryKeys.tasks(),
    queryFn: fetchTasks,
  })
}
