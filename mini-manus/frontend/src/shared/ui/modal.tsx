import type { PropsWithChildren, ReactNode } from 'react'
import { Button } from '@/shared/ui/button'

interface ModalProps {
  title: string
  description?: string
  isOpen: boolean
  onClose: () => void
  footer?: ReactNode
}

export function Modal({
  children,
  description,
  footer,
  isOpen,
  onClose,
  title,
}: PropsWithChildren<ModalProps>) {
  if (!isOpen) return null

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ui-modal__backdrop" onClick={onClose} />
      <div className="ui-modal__panel">
        <header className="ui-modal__header">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="关闭弹窗">
            关闭
          </Button>
        </header>
        <div className="ui-modal__body">{children}</div>
        {footer ? <footer className="ui-modal__footer">{footer}</footer> : null}
      </div>
    </div>
  )
}
