import type { ArtifactDetail } from '@/domains/artifact/types/artifact.types'
import type { PlanDetail } from '@/domains/plan/types/plan.types'
import type { ExecutorType, RunStatus, StepStatus } from '@/shared/types/status'

export interface SkillTraceItem {
  tool: string
  input: unknown
  output: string
}

export interface StepRunDetail {
  id: string
  runId: string
  planStepId: string
  executionOrder: number
  status: StepStatus
  executorType: ExecutorType
  skillName: string | null
  toolName: string | null
  toolInput: Record<string, unknown> | null
  toolOutput: string | null
  skillTrace: SkillTraceItem[] | null
  llmReasoning: string | null
  resultSummary: string | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export interface RunSummary {
  id: string
  revisionId: string
  runNumber: number
  status: RunStatus
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  errorMessage: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  estimatedCostUsd: number | null
}

export interface RunDetail extends RunSummary {
  taskId: string
  plans: PlanDetail[]
  stepRuns: StepRunDetail[]
  artifacts: ArtifactDetail[]
}

export interface LiveToolCall {
  id: string
  toolName: string
  state: 'pending' | 'completed' | 'failed'
  input: Record<string, unknown> | null
  output: string | null
  cached: boolean
  error: string | null
  errorCode: string | null
  startedAt: string
  completedAt: string | null
}

export interface LiveStepFeed {
  stepRunId: string
  planStepId: string | null
  description: string
  status: Exclude<StepStatus, 'pending' | 'skipped'>
  executorType: ExecutorType | null
  skillName: string | null
  toolName: string | null
  startedAt: string
  completedAt: string | null
  resultSummary: string | null
  errorMessage: string | null
  progressMessages: string[]
  toolCalls: LiveToolCall[]
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number | null
}

export interface LiveRunFeed {
  taskId: string
  runId: string
  runStatus: RunStatus
  latestNarration: string | null
  startedAt: string | null
  lastEventAt: string | null
  activeStepRunId: string | null
  stepOrder: string[]
  steps: Record<string, LiveStepFeed>
  tokenUsage: TokenUsage | null
}
