import { useMemo } from 'react'
import type { PlanDetail, PlanStep } from '@/domains/plan/types/plan.types'
import type { LiveRunFeed, StepRunDetail } from '@/domains/run/types/run.types'
import { EmptyState } from '@/shared/ui/empty-state'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/utils/cn'

// ─── PlanStepItem ─────────────────────────────────────────────────────────────

interface PlanStepItemProps {
  step: PlanStep
  stepRun: StepRunDetail | undefined
  liveStep: LiveRunFeed['steps'][string] | undefined
  /** run 已进入终态：忽略 live feed 里的步骤状态，只用服务端持久化数据 */
  isTerminal: boolean
}

function PlanStepItem({ step, stepRun, liveStep, isTerminal }: PlanStepItemProps) {
  const isActive = !isTerminal && liveStep?.status === 'running'
  const effectiveStatus = isActive ? liveStep!.status : stepRun?.status
  const progressMessage = isActive
    ? (liveStep!.progressMessages.at(-1) ?? null)
    : null
  const executor = step.skillName ?? step.toolHint ?? 'think'

  return (
    <li className={cn('plan-step', isActive && 'plan-step--active')}>
      <div className="plan-step__index">{step.stepIndex + 1}</div>
      <div className="plan-step__content">
        <div className="plan-step__title-row">
          <strong>{step.description}</strong>
          {effectiveStatus ? <StatusBadge status={effectiveStatus} /> : null}
        </div>
        <p className="plan-step__meta">{executor}</p>
        {progressMessage ? <p className="plan-step__progress">{progressMessage}</p> : null}
      </div>
    </li>
  )
}

// ─── PlanCard ─────────────────────────────────────────────────────────────────

interface PlanCardProps {
  plan: PlanDetail
  isActive: boolean
  latestStepRuns: Map<string, StepRunDetail>
  liveStepsByPlanStepId: Map<string, LiveRunFeed['steps'][string]>
  isTerminal: boolean
}

function PlanCard({ plan, isActive, latestStepRuns, liveStepsByPlanStepId, isTerminal }: PlanCardProps) {
  return (
    <details className="plan-card" open={isActive}>
      <summary className="plan-card__summary">
        <p>{isActive ? '当前计划' : `历史计划 v${plan.version}`}</p>
        <span>{plan.steps.length} 步</span>
      </summary>
      <ol className="plan-steps">
        {plan.steps.map((step) => (
          <PlanStepItem
            key={step.id}
            step={step}
            stepRun={latestStepRuns.get(step.id)}
            liveStep={liveStepsByPlanStepId.get(step.id)}
            isTerminal={isTerminal}
          />
        ))}
      </ol>
    </details>
  )
}

// ─── PlanSection ──────────────────────────────────────────────────────────────

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

  // 提升到循环外：只依赖 liveRunFeed.runStatus，所有步骤共享同一个结果
  const isTerminal =
    liveRunFeed != null &&
    (liveRunFeed.runStatus === 'completed' ||
      liveRunFeed.runStatus === 'failed' ||
      liveRunFeed.runStatus === 'cancelled')

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
            <PlanCard
              key={plan.id}
              plan={plan}
              isActive={plan.id === activePlanId}
              latestStepRuns={latestStepRuns}
              liveStepsByPlanStepId={liveStepsByPlanStepId}
              isTerminal={isTerminal}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
