import { useMemo } from 'react'
import type { PlanDetail } from '@/domains/plan/types/plan.types'
import type { LiveRunFeed, StepRunDetail } from '@/domains/run/types/run.types'
import { EmptyState } from '@/shared/ui/empty-state'
import { PanelSection } from '@/shared/ui/panel-section'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatDateTime, formatDuration } from '@/shared/utils/date'
import { prettyJson } from '@/shared/utils/text'

interface TimelineSectionProps {
  liveRunFeed: LiveRunFeed | null
  plans: PlanDetail[]
  stepRuns: StepRunDetail[]
}

export function TimelineSection({ liveRunFeed, plans, stepRuns }: TimelineSectionProps) {
  const stepDescriptions = useMemo(() => {
    const map = new Map<string, string>()

    for (const plan of plans) {
      for (const step of plan.steps) {
        map.set(step.id, step.description)
      }
    }

    return map
  }, [plans])

  const activeLiveStep = useMemo(() => {
    if (!liveRunFeed?.activeStepRunId) return null
    return liveRunFeed.steps[liveRunFeed.activeStepRunId] ?? null
  }, [liveRunFeed])

  if (!stepRuns.length && !activeLiveStep) {
    return (
      <PanelSection title="执行时间线" subtitle="工具调用与结果会实时出现在这里">
        <EmptyState title="暂无执行记录" description="开始运行后，这里会显示每一步的执行明细。" />
      </PanelSection>
    )
  }

  return (
    <PanelSection title="执行时间线" subtitle="按实际执行顺序回看过程">
      <div className="timeline">
        {liveRunFeed ? (
          <article className="timeline-item timeline-item--live">
            <div className="timeline-live__header">
              <div>
                <p className="timeline-item__eyebrow">Live Feed</p>
                <h3>{liveRunFeed.latestNarration ?? '正在等待新的执行反馈'}</h3>
              </div>
              <div className="timeline-live__status">
                <StatusBadge status={liveRunFeed.runStatus} />
                <span>{formatDateTime(liveRunFeed.lastEventAt ?? liveRunFeed.startedAt)}</span>
              </div>
            </div>

            {activeLiveStep ? (
              <div className="timeline-live__body">
                <div className="timeline-live__step">
                  <span className="timeline-live__label">当前步骤</span>
                  <strong>{activeLiveStep.description}</strong>
                </div>

                <div className="timeline-live__meta">
                  <span>
                    {activeLiveStep.executorType === 'skill' ? 'Skill' : 'Tool'}
                    {activeLiveStep.skillName
                      ? ` · ${activeLiveStep.skillName}`
                      : activeLiveStep.toolName
                        ? ` · ${activeLiveStep.toolName}`
                        : ''}
                  </span>
                  <span>{formatDuration(activeLiveStep.startedAt, activeLiveStep.completedAt)}</span>
                </div>

                {activeLiveStep.progressMessages.length ? (
                  <ul className="timeline-live__progress">
                    {activeLiveStep.progressMessages.map((message, index) => (
                      <li key={`${activeLiveStep.stepRunId}-progress-${index}`}>{message}</li>
                    ))}
                  </ul>
                ) : null}

                {activeLiveStep.toolCalls.length ? (
                  <div className="timeline-live__tools">
                    {activeLiveStep.toolCalls.map((toolCall) => (
                        <div key={toolCall.id} className="timeline-live__tool">
                          <div className="timeline-live__tool-head">
                            <span className="timeline-live__tool-name">{toolCall.toolName}</span>
                            <div className="timeline-live__tool-status">
                              {toolCall.cached ? (
                                <span className="timeline-live__cache">缓存命中</span>
                              ) : null}
                              <StatusBadge
                                status={
                                  toolCall.state === 'pending'
                                    ? 'running'
                                    : toolCall.state === 'failed'
                                      ? 'failed'
                                      : 'completed'
                                }
                              />
                            </div>
                        </div>
                        {toolCall.input ? (
                          <details className="timeline-item__detail">
                            <summary>工具输入</summary>
                            <pre>{prettyJson(toolCall.input)}</pre>
                          </details>
                        ) : null}
                        {toolCall.output ? (
                          <details className="timeline-item__detail">
                            <summary>工具输出</summary>
                            <pre>{toolCall.output}</pre>
                          </details>
                        ) : null}
                        {toolCall.error ? (
                          <p className="timeline-item__error">
                            {toolCall.errorCode ? `[${toolCall.errorCode}] ` : ''}
                            {toolCall.error}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        ) : null}

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
