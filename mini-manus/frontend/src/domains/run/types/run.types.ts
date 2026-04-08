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
}

export interface RunDetail extends RunSummary {
  taskId: string
  plans: PlanDetail[]
  stepRuns: StepRunDetail[]
  artifacts: ArtifactDetail[]
}
