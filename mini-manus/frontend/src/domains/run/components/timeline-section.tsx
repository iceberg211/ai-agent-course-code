import { useMemo } from 'react'
import type { PlanDetail } from '@/domains/plan/types/plan.types'
import type { LiveRunFeed, StepRunDetail } from '@/domains/run/types/run.types'
import { ApprovalPanel } from '@/domains/run/components/approval-panel'
import { EmptyState } from '@/shared/ui/empty-state'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatDateTime, formatDuration } from '@/shared/utils/date'
import { CodePreview, JsonPreview } from '@/shared/ui/code-preview'

interface TimelineSectionProps {
  taskId: string
  liveRunFeed: LiveRunFeed | null
  plans: PlanDetail[]
  stepRuns: StepRunDetail[]
  onApprove: (taskId: string, runId: string) => Promise<void>
  onReject: (taskId: string, runId: string) => Promise<void>
}

export function TimelineSection({ taskId, liveRunFeed, plans, stepRuns, onApprove, onReject }: TimelineSectionProps) {
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

  const hasContent = stepRuns.length > 0 || activeLiveStep !== null || liveRunFeed?.pendingApproval

  if (!hasContent && !liveRunFeed) {
    return (
      <section className="panel-section">
        <header className="panel-section__header">
          <p className="panel-section__eyebrow">执行过程</p>
        </header>
        <div className="panel-section__body">
          <EmptyState title="执行记录会出现在这里" description="任务开始后，每一步的工具调用和结果都会实时显示。" />
        </div>
      </section>
    )
  }

  return (
    <section className="panel-section">
      <header className="panel-section__header">
        <p className="panel-section__eyebrow">执行过程</p>
        {liveRunFeed && (
          <div className="panel-section__aside">
            <StatusBadge status={liveRunFeed.runStatus} />
          </div>
        )}
      </header>
      <div className="panel-section__body">
        <div className="timeline">
          {/* 实时进度区域 */}
          {liveRunFeed ? (
            <article className="timeline-item timeline-item--live">
              {/* 审批面板 */}
              {liveRunFeed.pendingApproval ? (
                <ApprovalPanel
                  runId={liveRunFeed.runId}
                  taskId={taskId}
                  pendingApproval={liveRunFeed.pendingApproval}
                  onApprove={onApprove}
                  onReject={onReject}
                />
              ) : null}

              {/* 当前执行步骤 */}
              {activeLiveStep ? (
                <div className="timeline-live__body">
                  <div className="timeline-live__step">
                    <strong>{activeLiveStep.description}</strong>
                    <span className="timeline-live__executor">
                      {activeLiveStep.skillName ?? activeLiveStep.toolName ?? ''}
                    </span>
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
                                <span className="timeline-live__cache">缓存</span>
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
                              <summary>输入</summary>
                              <div style={{ marginTop: '12px' }}>
                                <JsonPreview content={toolCall.input} />
                              </div>
                            </details>
                          ) : null}
                          {toolCall.output ? (
                            <details className="timeline-item__detail">
                              <summary>输出</summary>
                              <div style={{ marginTop: '12px' }}>
                                <CodePreview content={toolCall.output} />
                              </div>
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
              ) : liveRunFeed.latestNarration && !liveRunFeed.pendingApproval ? (
                <p className="timeline-live__narration">{liveRunFeed.latestNarration}</p>
              ) : null}
            </article>
          ) : null}

          {/* 历史步骤 */}
          {stepRuns.map((stepRun) => {
            const description =
              stepDescriptions.get(stepRun.planStepId) ?? `第 ${stepRun.executionOrder + 1} 步`

            return (
              <article key={stepRun.id} className={`timeline-item timeline-item--${stepRun.status}`}>
                <div className="timeline-item__header">
                  <div>
                    <p className="timeline-item__eyebrow">第 {stepRun.executionOrder + 1} 步</p>
                    <h3>{description}</h3>
                  </div>
                  <StatusBadge status={stepRun.status} />
                </div>

                <div className="timeline-item__meta">
                  <span>{stepRun.skillName ?? stepRun.toolName ?? '—'}</span>
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
                    <summary>输入</summary>
                    <div style={{ marginTop: '12px' }}>
                      <JsonPreview content={stepRun.toolInput} />
                    </div>
                  </details>
                ) : null}

                {stepRun.toolOutput ? (
                  <details className="timeline-item__detail">
                    <summary>输出</summary>
                    <div style={{ marginTop: '12px' }}>
                      <CodePreview content={stepRun.toolOutput} />
                    </div>
                  </details>
                ) : null}

                {stepRun.skillTrace?.length ? (
                  <details className="timeline-item__detail">
                    <summary>工具调用明细</summary>
                    <div className="skill-trace">
                      {stepRun.skillTrace.map((trace, index) => (
                        <div key={`${trace.tool}-${index}`} className="skill-trace__item">
                          <strong>{trace.tool}</strong>
                          <div style={{ marginTop: '12px' }}>
                            <JsonPreview content={trace.input} />
                            <CodePreview content={trace.output} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
