import type { KnowledgeEvalCase } from '@/types'

export function formatPercent(value?: number | null): string {
  if (value === undefined || value === null) return '0%'
  return `${Math.round(value * 100)}%`
}

export function formatMs(value: number): string {
  if (!value) return '-'
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.round(value)}ms`
}

export function scoreClass(val?: number | null) {
  if (val === undefined || val === null) return 'score-low'
  if (val >= 0.8) return 'score-high'
  if (val >= 0.5) return 'score-mid'
  return 'score-low'
}

export function scoreBadgeClass(val?: number | null) {
  const kind = scoreClass(val)
  if (kind === 'score-high') return 'bg-emerald-500/10 text-success'
  if (kind === 'score-mid') return 'bg-amber-500/10 text-warning'
  return 'bg-red-500/10 text-error'
}

export function reviewLabel(status?: string) {
  const labels: Record<string, string> = {
    passed: '已通过',
    failed: '不通过',
    unreviewed: '待审核',
  }
  return labels[status ?? ''] ?? '待审核'
}

export function resolveActualAnswer(item: KnowledgeEvalCase): string {
  return item.lastRunActualAnswer ?? item.last_run_actual_answer ?? ''
}

export function resolveHitRate(item: KnowledgeEvalCase): number | null {
  return item.lastRunHitRate ?? item.last_run_hit_rate ?? null
}

export function resolveRecall(item: KnowledgeEvalCase): number | null {
  return item.lastRunRecall ?? item.last_run_recall ?? null
}

export function resolveReviewStatus(item: KnowledgeEvalCase): string {
  return item.userReviewStatus ?? item.user_review_status ?? 'unreviewed'
}

export function resolveLastRunStatus(item: KnowledgeEvalCase): string {
  const record = item as KnowledgeEvalCase & { lastRunStatus?: string; last_run_status?: string }
  return record.lastRunStatus ?? record.last_run_status ?? ''
}

export function averageLatency(
  cases: KnowledgeEvalCase[],
  field: 'retrievalLatencyMs' | 'rerankLatencyMs',
): number {
  const snakeField = field === 'retrievalLatencyMs' ? 'retrieval_latency_ms' : 'rerank_latency_ms'
  const values = cases
    .map((item) => {
      const record = item as KnowledgeEvalCase & Record<string, number | undefined>
      return record[field] ?? record[snakeField]
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export function buildDiagnosticCards(cases: KnowledgeEvalCase[]) {
  const failed = cases.filter(
    (item) => resolveLastRunStatus(item) === 'failed' || resolveReviewStatus(item) === 'failed',
  )
  const lowHit = cases.filter((item) => {
    const score = resolveHitRate(item)
    return score !== null && score < 0.5
  })
  const unrun = cases.filter((item) => !resolveLastRunStatus(item) && !resolveActualAnswer(item))
  const running = cases.filter((item) => resolveLastRunStatus(item) === 'running')
  const retrieval = averageLatency(cases, 'retrievalLatencyMs')
  const rerank = averageLatency(cases, 'rerankLatencyMs')

  return [
    { label: '失败用例', value: failed.length, hint: '运行失败或审核不通过' },
    { label: '低命中', value: lowHit.length, hint: '命中率低于 50%' },
    { label: '未运行', value: unrun.length, hint: '尚无评测结果' },
    { label: '运行中', value: running.length, hint: '后端任务未完成' },
    { label: '平均耗时', value: formatMs(retrieval + rerank), hint: '检索与重排' },
  ]
}

export function buildFailureBuckets(cases: KnowledgeEvalCase[]) {
  return [
    {
      key: 'retrieval',
      label: '检索不足',
      count: cases.filter((item) => {
        const hitRate = resolveHitRate(item)
        return hitRate !== null && hitRate < 0.35
      }).length,
      description: '通常需要检查分片质量、关键词召回、向量阈值和知识库范围。',
    },
    {
      key: 'rerank',
      label: '重排不足',
      count: cases.filter((item) => {
        const hitRate = resolveHitRate(item)
        const recall = resolveRecall(item)
        return hitRate !== null && recall !== null && hitRate >= 0.5 && recall < 0.5
      }).length,
      description: '候选已召回但最终排序不理想，可重点查看 Rerank 模型和 TopK 设置。',
    },
    {
      key: 'answer',
      label: '答案质量不足',
      count: cases.filter(
        (item) =>
          resolveLastRunStatus(item) === 'failed' &&
          resolveHitRate(item) !== null &&
          (resolveHitRate(item) ?? 0) >= 0.5,
      ).length,
      description: '证据可能存在，但生成答案不符合预期，需要复查提示词和引用约束。',
    },
    {
      key: 'review',
      label: '人工驳回',
      count: cases.filter((item) => resolveReviewStatus(item) === 'failed').length,
      description: '人工审核标记不通过，适合沉淀为回归测试优先用例。',
    },
  ]
}
