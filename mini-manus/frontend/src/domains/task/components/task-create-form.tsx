import { useDeferredValue, useState } from 'react'
import type { ApprovalMode } from '@/core/api/task.api'
import { Button } from '@/shared/ui/button'

// ─── 任务模板 ─────────────────────────────────────────────────────────────────
const TASK_TEMPLATES = [
  {
    label: '调研报告',
    icon: '🔍',
    text: '调研 {主题} 的技术方案、主流实现和最佳实践，输出结构化中文报告',
  },
  {
    label: '竞品对比',
    icon: '⚖️',
    text: '对比 {A} 和 {B} 在产品定位、核心能力和适用场景上的差异，给出选型建议',
  },
  {
    label: '代码生成',
    icon: '💻',
    text: '用 TypeScript 实现 {功能描述}，要求：代码完整可运行，附简短说明',
  },
  {
    label: '会前 Briefing',
    icon: '📋',
    text: '为即将进行的 {会议主题} 准备 briefing，受众是项目团队，目标是快速建立共识',
  },
]

const APPROVAL_MODES: { value: ApprovalMode; label: string; hint: string }[] = [
  { value: 'none', label: '直接执行', hint: '不等待确认' },
  { value: 'plan_first', label: '先看计划', hint: '生成计划后确认再执行' },
  { value: 'side_effects', label: '副作用前确认', hint: '写文件等操作前暂停' },
  { value: 'all_steps', label: '每步确认', hint: '每一步都等待审批' },
]

interface TaskCreateFormProps {
  isPending: boolean
  onCreate: (input: string, approvalMode: ApprovalMode) => Promise<unknown>
}

export function TaskCreateForm({ isPending, onCreate }: TaskCreateFormProps) {
  const [input, setInput] = useState('')
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('none')
  const [showTemplates, setShowTemplates] = useState(false)
  const deferredInput = useDeferredValue(input)
  const canSubmit = deferredInput.trim().length > 0 && !isPending

  function applyTemplate(text: string) {
    setInput(text)
    setShowTemplates(false)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextInput = input.trim()
    if (!nextInput) return
    try {
      await onCreate(nextInput, approvalMode)
      setInput('')
      setApprovalMode('none')
    } catch {
      // 保留输入内容，方便用户修正后重试
    }
  }

  return (
    <form className="task-create-form" onSubmit={handleSubmit}>
      <div className="task-create-form__top">
        <label className="task-create-form__label" htmlFor="task-input">
          新任务
        </label>
        <button
          type="button"
          className="task-create-form__template-toggle"
          onClick={() => setShowTemplates((v) => !v)}
        >
          {showTemplates ? '收起模板' : '模板'}
        </button>
      </div>

      {showTemplates && (
        <div className="task-create-form__templates">
          {TASK_TEMPLATES.map((tpl) => (
            <button
              key={tpl.label}
              type="button"
              className="task-create-form__tpl-btn"
              onClick={() => applyTemplate(tpl.text)}
            >
              <span>{tpl.icon}</span>
              <span>{tpl.label}</span>
            </button>
          ))}
        </div>
      )}

      <textarea
        id="task-input"
        className="task-create-form__textarea"
        placeholder="输入一个明确任务，比如：调研 React Compiler 并整理成笔记"
        value={input}
        rows={4}
        onChange={(event) => setInput(event.target.value)}
      />

      {/* 审批模式选择器 */}
      <div className="task-create-form__approval">
        <span className="task-create-form__approval-label">执行模式</span>
        <div className="task-create-form__approval-options">
          {APPROVAL_MODES.map((mode) => (
            <label
              key={mode.value}
              className={`task-create-form__approval-opt${approvalMode === mode.value ? ' task-create-form__approval-opt--active' : ''}`}
              title={mode.hint}
            >
              <input
                type="radio"
                name="approvalMode"
                value={mode.value}
                checked={approvalMode === mode.value}
                onChange={() => setApprovalMode(mode.value)}
              />
              {mode.label}
            </label>
          ))}
        </div>
      </div>

      <Button type="submit" variant="primary" fullWidth disabled={!canSubmit}>
        {isPending ? '创建中...' : '提交任务'}
      </Button>
    </form>
  )
}
