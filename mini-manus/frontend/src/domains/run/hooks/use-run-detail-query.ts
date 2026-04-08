import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRunDetail } from '@/core/api/task.api'
import { queryKeys } from '@/core/api/query-keys'
import type { RunDetail } from '@/domains/run/types/run.types'

export function useRunDetailQuery(
  taskId: string | null,
  runId: string | null,
  currentRun: RunDetail | null,
) {
  const shouldFetch = Boolean(taskId && runId && currentRun?.id !== runId)

  const query = useQuery({
    queryKey: queryKeys.runDetail(taskId ?? 'empty', runId ?? 'empty'),
    queryFn: () => fetchRunDetail(taskId!, runId!),
    enabled: shouldFetch,
  })

  const runDetail = useMemo(() => {
    if (!runId) return currentRun
    if (currentRun && currentRun.id === runId) return currentRun
    return query.data ?? null
  }, [currentRun, query.data, runId])

  return {
    ...query,
    runDetail,
  }
}
