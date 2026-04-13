export const queryKeys = {
  tasks: () => ['tasks'] as const,
  taskDetail: (taskId: string) => ['tasks', taskId, 'detail'] as const,
  runDetail: (taskId: string, runId: string) =>
    ['tasks', taskId, 'runs', runId] as const,
  taskEvents: (taskId: string, runId?: string | null) =>
    ['tasks', taskId, 'events', runId ?? 'all'] as const,
}
