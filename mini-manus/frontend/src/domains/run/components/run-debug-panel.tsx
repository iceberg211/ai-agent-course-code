import { useMemo } from 'react'
import type { LiveRunFeed, RunDetail } from '@/domains/run/types/run.types'
import { EmptyState } from '@/shared/ui/empty-state'
import { PanelSection } from '@/shared/ui/panel-section'
import { formatDateTime, formatDuration } from '@/shared/utils/date'

interface RunDebugPanelProps {
  liveRunFeed: LiveRunFeed | null
  runDetail: RunDetail | null
}

function formatMetric(value: number | string | null | undefined) {
  if (value == null || value === '') return '--'
  return String(value)
}

export function RunDebugPanel({ liveRunFeed, runDetail }: RunDebugPanelProps) {
  const metrics = useMemo(() => {
    if (!runDetail) return null

    const lastFailedStep = [...runDetail.stepRuns]
      .reverse()
      .find((stepRun) => stepRun.errorMessage)

    const toolCalls = Object.values(liveRunFeed?.steps ?? {}).flatMap((step) => step.toolCalls)
    const cacheHits = toolCalls.filter((tool) => tool.cached).length
    const cacheMisses = toolCalls.filter((tool) => !tool.cached && tool.state !== 'pending').length

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
      tokenUsage: liveRunFeed?.tokenUsage ?? null,
    }
  }, [liveRunFeed?.steps, liveRunFeed?.tokenUsage, runDetail])

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
  ]

  return (
    <PanelSection title="Run Debug" subtitle="帮助我们快速观察本轮执行质量与交付情况">
      <div className="run-debug">
        <div className="run-debug__grid">
          {items.map((item) => (
            <article key={item.label} className="run-debug__card">
              <p className="run-debug__label">{item.label}</p>
              <strong className="run-debug__value">{item.value}</strong>
            </article>
          ))}
        </div>

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
