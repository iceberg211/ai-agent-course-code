import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'
import { cn } from '@/shared/utils/cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  fullWidth?: boolean
}

export function Button({
  children,
  className,
  fullWidth = false,
  type = 'button',
  variant = 'secondary',
  ...props
}: PropsWithChildren<ButtonProps>) {
  return (
    <button
      type={type}
      className={cn(
        'ui-button',
        `ui-button--${variant}`,
        fullWidth && 'ui-button--full',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
