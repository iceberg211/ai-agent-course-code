import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'

interface TaskEditModalProps {
  initialValue: string
  isOpen: boolean
  isPending: boolean
  onClose: () => void
  onSubmit: (input: string) => Promise<unknown>
}

export function TaskEditModal({
  initialValue,
  isOpen,
  isPending,
  onClose,
  onSubmit,
}: TaskEditModalProps) {
  if (!isOpen) return null

  return (
    <TaskEditModalBody
      initialValue={initialValue}
      isPending={isPending}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  )
}

interface TaskEditModalBodyProps {
  initialValue: string
  isPending: boolean
  onClose: () => void
  onSubmit: (input: string) => Promise<unknown>
}

function TaskEditModalBody({
  initialValue,
  isPending,
  onClose,
  onSubmit,
}: TaskEditModalBodyProps) {
  const [value, setValue] = useState(initialValue)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextValue = value.trim()
    if (!nextValue) return

    await onSubmit(nextValue)
  }

  return (
    <Modal
      title="编辑任务"
      description="提交后会创建新的 Revision，并在旧运行结束后启动最新运行。"
      isOpen
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" form="task-edit-form" type="submit" disabled={isPending}>
            {isPending ? '提交中...' : '保存并重跑'}
          </Button>
        </>
      }
    >
      <form id="task-edit-form" className="task-edit-form" onSubmit={handleSubmit}>
        <label htmlFor="task-edit-input">任务描述</label>
        <textarea
          id="task-edit-input"
          value={value}
          rows={8}
          onChange={(event) => setValue(event.target.value)}
        />
      </form>
    </Modal>
  )
}
