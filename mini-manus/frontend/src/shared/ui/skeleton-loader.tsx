interface SkeletonLoaderProps {
  className?: string
}

export function SkeletonLoader({ className }: SkeletonLoaderProps) {
  return (
    <div className={`skeleton-loader ${className ?? ''}`}>
      {/* 任务头部区 */}
      <div className="skeleton-card skeleton-card--header">
        <div className="skeleton-block skeleton-block--title" />
        <div className="skeleton-block skeleton-block--line" />
        <div className="skeleton-block skeleton-block--line skeleton-block--short" />
        <div className="skeleton-toolbar">
          <div className="skeleton-pill" />
          <div className="skeleton-pill" />
          <div className="skeleton-pill skeleton-pill--wide" />
        </div>
      </div>

      {/* 主内容双列区 */}
      <div className="skeleton-columns">
        <div className="skeleton-card skeleton-card--tall">
          <div className="skeleton-block skeleton-block--eyebrow" />
          <div className="skeleton-block skeleton-block--line" />
          <div className="skeleton-block skeleton-block--line skeleton-block--short" />
          <div className="skeleton-block skeleton-block--line skeleton-block--mid" />
          <div className="skeleton-block skeleton-block--line skeleton-block--short" />
        </div>
        <div className="skeleton-card skeleton-card--tall">
          <div className="skeleton-block skeleton-block--eyebrow" />
          <div className="skeleton-block skeleton-block--line skeleton-block--mid" />
          <div className="skeleton-block skeleton-block--line skeleton-block--short" />
        </div>
      </div>
    </div>
  )
}
