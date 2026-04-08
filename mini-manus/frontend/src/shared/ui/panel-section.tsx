import type { PropsWithChildren, ReactNode } from 'react'

interface PanelSectionProps {
  title: string
  subtitle?: string
  aside?: ReactNode
}

export function PanelSection({
  aside,
  children,
  subtitle,
  title,
}: PropsWithChildren<PanelSectionProps>) {
  return (
    <section className="panel-section">
      <header className="panel-section__header">
        <div>
          <p className="panel-section__eyebrow">{title}</p>
          {subtitle ? <h2 className="panel-section__subtitle">{subtitle}</h2> : null}
        </div>
        {aside ? <div className="panel-section__aside">{aside}</div> : null}
      </header>
      <div className="panel-section__body">{children}</div>
    </section>
  )
}
