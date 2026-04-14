import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LiveRunFeed, RunDetail } from '@/domains/run/types/run.types'
import { fetchLlmCallLogs } from '@/core/api/task.api'
import { EmptyState } from '@/shared/ui/empty-state'
import { PanelSection } from '@/shared/ui/panel-section'
import { formatDateTime, formatDuration } from '@/shared/utils/date'

interface RunDebugPanelProps {
  taskId: string | null
  liveRunFeed: LiveRunFeed | null
  runDetail: RunDetail | null
}

function formatMetric(value: number | string | null | undefined) {
  if (value == null || value === '') return '--'
  return String(value)
}

function formatCost(value: number | string | null) {
  if (value == null || value === '') return '--'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (!Number.isFinite(num)) return '--'
  return `$${num.toFixed(6)}`
}

function formatUnknownNumber(value: unknown) {
  if (value == null || value === '') return '--'
  const num = Number(value)
  return Number.isFinite(num) ? String(num) : '--'
}

export function RunDebugPanel({ taskId, liveRunFeed, runDetail }: RunDebugPanelProps) {
  // P24：节点级 token 明细
  const llmCallsQuery = useQuery({
    queryKey: ['llm-calls', taskId, runDetail?.id],
    queryFn: () => fetchLlmCallLogs(taskId!, runDetail!.id),
    enabled: !!taskId && !!runDetail?.id,
    staleTime: 30_000,
  })

  const metrics = useMemo(() => {
    if (!runDetail) return null

    const lastFailedStep = [...runDetail.stepRuns]
      .reverse()
      .find((stepRun) => stepRun.errorMessage)

    const toolCalls = Object.values(liveRunFeed?.steps ?? {}).flatMap((step) => step.toolCalls)
    const cacheHits = toolCalls.filter((tool) => tool.cached).length
    const cacheMisses = toolCalls.filter((tool) => !tool.cached && tool.state !== 'pending').length
    const persistedTokenUsage =
      runDetail.totalTokens != null
        ? {
            inputTokens: runDetail.inputTokens ?? 0,
            outputTokens: runDetail.outputTokens ?? 0,
            totalTokens: runDetail.totalTokens,
            estimatedCostUsd: runDetail.estimatedCostUsd,
          }
        : null

    return {
      duration: formatDuration(runDetail.startedAt, runDetail.completedAt),
      stepCount: runDetail.stepRuns.length,
      retryCount: runDetail.stepRuns.filter((stepRun) => stepRun.status === 'failed').length,
      replanCount: Math.max(runDetail.plans.length - 1, 0),
      artifactCount: runDetail.artifacts.length,
      cacheHits: toolCalls.length ? cacheHits : null,
      cacheMisses: toolCalls.length ? cacheMisses : null,
      lastError: runDetail.errorMessage ?? lastFailedStep?.errorMessage ?? null,
      artifactTypes: Array.from(new Set(runDetail.artifacts.map((artifact) => artifact.type))).join(', '),
      startedAt: formatDateTime(runDetail.startedAt ?? runDetail.createdAt),
      modelName: runDetail.modelName,
      tokenUsage: liveRunFeed?.tokenUsage ?? persistedTokenUsage,
      budgetExceeded:
        liveRunFeed?.terminalErrorCode === 'token_budget_exceeded' ||
        runDetail.errorMessage === 'token_budget_exceeded',
      budgetMetadata: liveRunFeed?.terminalErrorMetadata ?? null,
    }
  }, [
    liveRunFeed?.steps,
    liveRunFeed?.terminalErrorCode,
    liveRunFeed?.terminalErrorMetadata,
    liveRunFeed?.tokenUsage,
    runDetail,
  ])

  if (!metrics) {
    return (
      <PanelSection title="Run Debug" subtitle="当前没有可调试的执行信息">
        <EmptyState title="暂无 Run" description="选中一条运行记录后，这里会显示运行指标与调试摘要。" />
      </PanelSection>
    )
  }

  const items = [
    { label: '开始时间', value: metrics.startedAt },
    { label: '总耗时', value: metrics.duration },
    { label: '步骤数', value: metrics.stepCount },
    { label: '失败/重试步数', value: metrics.retryCount },
    { label: '重规划次数', value: metrics.replanCount },
    { label: '产物数量', value: metrics.artifactCount },
    { label: 'Cache Hit', value: formatMetric(metrics.cacheHits) },
    { label: 'Cache Miss', value: formatMetric(metrics.cacheMisses) },
    { label: '产物类型', value: metrics.artifactTypes || '--' },
    { label: 'Model', value: metrics.modelName ?? '--' },
    {
      label: 'Input Tokens',
      value: metrics.tokenUsage ? String(metrics.tokenUsage.inputTokens) : '--',
    },
    {
      label: 'Output Tokens',
      value: metrics.tokenUsage ? String(metrics.tokenUsage.outputTokens) : '--',
    },
    {
      label: 'Total Tokens',
      value: metrics.tokenUsage ? String(metrics.tokenUsage.totalTokens) : '--',
    },
    {
      label: 'Estimated Cost',
      value: metrics.tokenUsage ? formatCost(metrics.tokenUsage.estimatedCostUsd) : '--',
    },
  ]

  const llmCalls = llmCallsQuery.data ?? []

  return (
    <PanelSection title="Run Debug" subtitle="帮助我们快速观察本轮执行质量与交付情况">
      <div className="run-debug">
        {metrics.budgetExceeded ? (
          <div className="run-debug__alert">
            <p className="run-debug__label">Token Budget Alert</p>
            <strong>任务因预算保护被强制终止</strong>
            <span>
              Budget: {formatUnknownNumber(metrics.budgetMetadata?.['budget'])} tokens · Used:{' '}
              {formatUnknownNumber(metrics.budgetMetadata?.['usedTokens'])} tokens · Cost:{' '}
              {formatCost(metrics.budgetMetadata?.['estimatedCostUsd'] as number | string | null)}
            </span>
          </div>
        ) : null}

        <div className="run-debug__grid">
          {items.map((item) => (
            <article key={item.label} className="run-debug__card">
              <p className="run-debug__label">{item.label}</p>
              <strong className="run-debug__value">{item.value}</strong>
            </article>
          ))}
        </div>

        {/* P24：节点级 LLM 调用明细 */}
        {llmCalls.length > 0 ? (
          <div className="run-debug__llm-calls">
            <p className="run-debug__label">节点 Token 明细</p>
            <table className="run-debug__llm-table">
              <thead>
                <tr>
                  <th>节点</th>
                  <th>输入</th>
                  <th>输出</th>
                  <th>成本</th>
                  <th>耗时</th>
                </tr>
              </thead>
              <tbody>
                {llmCalls.map((call) => (
                  <tr key={call.id}>
                    <td className="run-debug__llm-node">{call.nodeName}</td>
                    <td>{call.inputTokens}</td>
                    <td>{call.outputTokens}</td>
                    <td>{formatCost(call.estimatedCostUsd)}</td>
                    <td>{call.durationMs != null ? `${call.durationMs}ms` : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {metrics.lastError ? (
          <div className="run-debug__error">
            <p className="run-debug__label">最后错误</p>
            <strong>{metrics.lastError}</strong>
          </div>
        ) : null}
      </div>
    </PanelSection>
  )
}
