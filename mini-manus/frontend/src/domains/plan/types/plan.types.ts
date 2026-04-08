export interface PlanStep {
  id: string
  planId: string
  stepIndex: number
  description: string
  skillName: string | null
  skillInput: Record<string, unknown> | null
  toolHint: string | null
  createdAt: string
}

export interface PlanDetail {
  id: string
  runId: string
  version: number
  createdAt: string
  steps: PlanStep[]
}
