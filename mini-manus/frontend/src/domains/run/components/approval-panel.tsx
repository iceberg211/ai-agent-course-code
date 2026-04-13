import { useState } from 'react'
import type { PendingApproval } from '@/domains/run/types/run.types'

interface ApprovalPanelProps {
  runId: string
  taskId: string
  pendingApproval: PendingApproval
  onApprove: (taskId: string, runId: string) => Promise<void>
  onReject: (taskId: string, runId: string) => Promise<void>
}

export function ApprovalPanel({ runId, taskId, pendingApproval, onApprove, onReject }: ApprovalPanelProps) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)

  const handle = async (action: 'approve' | 'reject') => {
    setLoading(action)
    try {
      if (action === 'approve') await onApprove(taskId, runId)
      else await onReject(taskId, runId)
    } finally {
      setLoading(null)
    }
  }

  const isPlanReview = pendingApproval.type === 'plan_review'

  return (
    <div className="approval-panel">
      <div className="approval-panel__header">
        <span className="approval-panel__icon">⏸</span>
        <strong>{isPlanReview ? '计划待审批' : '步骤待审批'}</strong>
        <span className="approval-panel__badge">等待确认</span>
      </div>

      {isPlanReview && pendingApproval.steps && (
        <div className="approval-panel__plan">
          <p className="approval-panel__hint">
            Agent 生成了以下 {pendingApproval.stepCount ?? pendingApproval.steps.length} 步计划，确认后开始执行：
          </p>
          <ol className="approval-panel__steps">
            {pendingApproval.steps.map((step) => (
              <li key={step.stepIndex} className="approval-panel__step">
                <span className="approval-panel__step-desc">{step.description}</span>
                <div className="approval-panel__step-meta">
                  <code>{step.executor}</code>
                  {step.isSideEffect && (
                    <span className="approval-panel__side-effect">副作用</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!isPlanReview && (
        <div className="approval-panel__step-info">
          <p>{pendingApproval.description}</p>
          <div className="approval-panel__step-meta">
            <code>{pendingApproval.toolOrSkill}</code>
            {pendingApproval.isSideEffect && (
              <span className="approval-panel__side-effect">副作用</span>
            )}
          </div>
        </div>
      )}

      <div className="approval-panel__actions">
        <button
          className="approval-panel__btn approval-panel__btn--approve"
          onClick={() => void handle('approve')}
          disabled={loading !== null}
        >
          {loading === 'approve' ? '执行中…' : '✓ 批准'}
        </button>
        <button
          className="approval-panel__btn approval-panel__btn--reject"
          onClick={() => void handle('reject')}
          disabled={loading !== null}
        >
          {loading === 'reject' ? '处理中…' : '✕ 拒绝'}
        </button>
      </div>
    </div>
  )
}
