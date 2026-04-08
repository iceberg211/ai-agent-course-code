import { useMemo } from 'react'
import type { PlanDetail } from '@/domains/plan/types/plan.types'
import type { LiveRunFeed, StepRunDetail } from '@/domains/run/types/run.types'
import { EmptyState } from '@/shared/ui/empty-state'
import { PanelSection } from '@/shared/ui/panel-section'
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

      if (step?.planStepId) {
        map.set(step.planStepId, step)
      }
    }

    return map
  }, [liveRunFeed])

  if (!plans.length) {
    return (
      <PanelSection title="执行计划" subtitle="等待规划器输出步骤">
        <EmptyState title="还没有计划" description="任务开始执行后，这里会出现分步骤计划。" />
      </PanelSection>
    )
  }

  const activePlanId = plans[0]?.id

  return (
    <PanelSection title="执行计划" subtitle="按计划版本查看步骤拆解">
      <div className="plan-stack">
        {plans.map((plan) => (
          <details key={plan.id} className="plan-card" open={plan.id === activePlanId}>
            <summary className="plan-card__summary">
              <div>
                <p>Plan v{plan.version}</p>
                <span>{plan.id === activePlanId ? '当前生效' : '历史计划'}</span>
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
                      <p className="plan-step__meta">
                        {step.skillName
                          ? `Skill · ${step.skillName}`
                          : `Tool Hint · ${step.toolHint ?? 'think'}`}
                      </p>
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
    </PanelSection>
  )
}
