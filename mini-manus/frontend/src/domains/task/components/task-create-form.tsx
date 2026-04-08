import { useDeferredValue, useState } from 'react'
import { Button } from '@/shared/ui/button'

interface TaskCreateFormProps {
  isPending: boolean
  onCreate: (input: string) => Promise<unknown>
}

export function TaskCreateForm({ isPending, onCreate }: TaskCreateFormProps) {
  const [input, setInput] = useState('')
  const deferredInput = useDeferredValue(input)
  const canSubmit = deferredInput.trim().length > 0 && !isPending

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextInput = input.trim()
    if (!nextInput) return

    try {
      await onCreate(nextInput)
      setInput('')
    } catch {
      // 保留输入内容，方便用户修正后重试。
    }
  }

  return (
    <form className="task-create-form" onSubmit={handleSubmit}>
      <label className="task-create-form__label" htmlFor="task-input">
        新任务
      </label>
      <textarea
        id="task-input"
        className="task-create-form__textarea"
        placeholder="输入一个明确任务，比如：调研 React Compiler 并整理成笔记"
        value={input}
        rows={4}
        onChange={(event) => setInput(event.target.value)}
      />
      <Button type="submit" variant="primary" fullWidth disabled={!canSubmit}>
        {isPending ? '创建中...' : '提交任务'}
      </Button>
    </form>
  )
}
