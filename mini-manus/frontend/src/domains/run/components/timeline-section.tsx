import { useMemo } from 'react'
import type { PlanDetail } from '@/domains/plan/types/plan.types'
import type { StepRunDetail } from '@/domains/run/types/run.types'
import { EmptyState } from '@/shared/ui/empty-state'
import { PanelSection } from '@/shared/ui/panel-section'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatDateTime, formatDuration } from '@/shared/utils/date'
import { prettyJson } from '@/shared/utils/text'

interface TimelineSectionProps {
  plans: PlanDetail[]
  stepRuns: StepRunDetail[]
}

export function TimelineSection({ plans, stepRuns }: TimelineSectionProps) {
  const stepDescriptions = useMemo(() => {
    const map = new Map<string, string>()

    for (const plan of plans) {
      for (const step of plan.steps) {
        map.set(step.id, step.description)
      }
    }

    return map
  }, [plans])

  if (!stepRuns.length) {
    return (
      <PanelSection title="执行时间线" subtitle="工具调用与结果会实时出现在这里">
        <EmptyState title="暂无执行记录" description="开始运行后，这里会显示每一步的执行明细。" />
      </PanelSection>
    )
  }

  return (
    <PanelSection title="执行时间线" subtitle="按实际执行顺序回看过程">
      <div className="timeline">
        {stepRuns.map((stepRun) => {
          const description =
            stepDescriptions.get(stepRun.planStepId) ?? `步骤 ${stepRun.executionOrder + 1}`

          return (
            <article key={stepRun.id} className={`timeline-item timeline-item--${stepRun.status}`}>
              <div className="timeline-item__header">
                <div>
                  <p className="timeline-item__eyebrow">Step {stepRun.executionOrder + 1}</p>
                  <h3>{description}</h3>
                </div>
                <StatusBadge status={stepRun.status} />
              </div>

              <div className="timeline-item__meta">
                <span>{stepRun.executorType === 'skill' ? 'Skill' : 'Tool'}</span>
                <span>{stepRun.skillName ?? stepRun.toolName ?? '等待执行'}</span>
                <span>{formatDuration(stepRun.startedAt, stepRun.completedAt)}</span>
                <span>{formatDateTime(stepRun.completedAt ?? stepRun.startedAt)}</span>
              </div>

              {stepRun.resultSummary ? (
                <p className="timeline-item__summary">{stepRun.resultSummary}</p>
              ) : null}

              {stepRun.errorMessage ? (
                <p className="timeline-item__error">{stepRun.errorMessage}</p>
              ) : null}

              {stepRun.toolInput ? (
                <details className="timeline-item__detail">
                  <summary>工具输入</summary>
                  <pre>{prettyJson(stepRun.toolInput)}</pre>
                </details>
              ) : null}

              {stepRun.toolOutput ? (
                <details className="timeline-item__detail">
                  <summary>工具输出</summary>
                  <pre>{stepRun.toolOutput}</pre>
                </details>
              ) : null}

              {stepRun.skillTrace?.length ? (
                <details className="timeline-item__detail">
                  <summary>Skill Trace</summary>
                  <div className="skill-trace">
                    {stepRun.skillTrace.map((trace, index) => (
                      <div key={`${trace.tool}-${index}`} className="skill-trace__item">
                        <strong>{trace.tool}</strong>
                        <pre>{prettyJson(trace.input)}</pre>
                        <pre>{trace.output}</pre>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </article>
          )
        })}
      </div>
    </PanelSection>
  )
}
