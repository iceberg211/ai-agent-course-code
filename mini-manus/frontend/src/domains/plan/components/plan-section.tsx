import { useMemo } from 'react'
import type { PlanDetail } from '@/domains/plan/types/plan.types'
import type { LiveRunFeed, StepRunDetail } from '@/domains/run/types/run.types'
import { EmptyState } from '@/shared/ui/empty-state'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/utils/cn'

interface PlanSectionProps {
  liveRunFeed: LiveRunFeed | null
  plans: PlanDetail[]
  stepRuns: StepRunDetail[]
}

export function PlanSection({ liveRunFeed, plans, stepRuns }: PlanSectionProps) {
  const latestStepRuns = useMemo(() => {
    const map = new Map<string, StepRunDetail>()
    for (const stepRun of stepRuns) {
      const current = map.get(stepRun.planStepId)
      if (!current || current.executionOrder < stepRun.executionOrder) {
        map.set(stepRun.planStepId, stepRun)
      }
    }
    return map
  }, [stepRuns])

  const liveStepsByPlanStepId = useMemo(() => {
    const map = new Map<string, LiveRunFeed['steps'][string]>()
    if (!liveRunFeed) return map
    for (const stepRunId of liveRunFeed.stepOrder) {
      const step = liveRunFeed.steps[stepRunId]
      if (step?.planStepId) map.set(step.planStepId, step)
    }
    return map
  }, [liveRunFeed])

  if (!plans.length) {
    return (
      <section className="panel-section">
        <header className="panel-section__header">
          <p className="panel-section__eyebrow">执行计划</p>
        </header>
        <div className="panel-section__body">
          <EmptyState title="计划生成后显示在这里" description="" />
        </div>
      </section>
    )
  }

  const activePlanId = plans[0]?.id

  return (
    <section className="panel-section">
      <header className="panel-section__header">
        <p className="panel-section__eyebrow">执行计划</p>
        {plans.length > 1 && (
          <span className="panel-section__aside" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            共 {plans.length} 版
          </span>
        )}
      </header>
      <div className="panel-section__body">
        <div className="plan-stack">
          {plans.map((plan) => (
            <details key={plan.id} className="plan-card" open={plan.id === activePlanId}>
              <summary className="plan-card__summary">
                <div>
                  <p>
                    {plan.id === activePlanId ? '当前计划' : `历史计划 v${plan.version}`}
                  </p>
                </div>
                <span>{plan.steps.length} 步</span>
              </summary>

              <ol className="plan-steps">
                {plan.steps.map((step) => {
                  const stepRun = latestStepRuns.get(step.id)
                  const liveStep = liveStepsByPlanStepId.get(step.id)
                  const effectiveStatus =
                    liveStep?.status === 'running' ? liveStep.status : stepRun?.status
                  const progressMessage =
                    liveStep?.progressMessages[liveStep.progressMessages.length - 1] ?? null
                  const executor = step.skillName ?? step.toolHint ?? 'think'

                  return (
                    <li
                      key={step.id}
                      className={cn(
                        'plan-step',
                        liveStep?.status === 'running' && 'plan-step--active',
                      )}
                    >
                      <div className="plan-step__index">{step.stepIndex + 1}</div>
                      <div className="plan-step__content">
                        <div className="plan-step__title-row">
                          <strong>{step.description}</strong>
                          {effectiveStatus ? <StatusBadge status={effectiveStatus} /> : null}
                        </div>
                        <p className="plan-step__meta">{executor}</p>
                        {progressMessage ? (
                          <p className="plan-step__progress">{progressMessage}</p>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
