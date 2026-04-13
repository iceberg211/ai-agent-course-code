import { apiClient } from '@/core/api/client'
import type { ArtifactDetail } from '@/domains/artifact/types/artifact.types'
import type { PlanDetail, PlanStep } from '@/domains/plan/types/plan.types'
import type {
  RunDetail,
  RunSummary,
  SkillTraceItem,
  StepRunDetail,
} from '@/domains/run/types/run.types'
import type {
  TaskDetail,
  TaskRevision,
  TaskSummary,
} from '@/domains/task/types/task.types'

type NumberLike = number | string | null | undefined

interface RunSummaryResponse
  extends Omit<
    RunSummary,
    'inputTokens' | 'outputTokens' | 'totalTokens' | 'estimatedCostUsd' | 'modelName'
  > {
  estimatedCostUsd?: NumberLike
  inputTokens?: number | null
  modelName?: string | null
  outputTokens?: number | null
  totalTokens?: number | null
}

interface RunDetailResponse extends RunSummaryResponse {
  taskId: string
  plans: PlanDetailResponse[]
  stepRuns: StepRunResponse[]
  artifacts: ArtifactResponse[]
}

interface PlanDetailResponse {
  id: string
  runId: string
  version: number
  createdAt: string
  steps: PlanStepResponse[]
}

interface PlanStepResponse {
  id: string
  planId: string
  stepIndex: number
  description: string
  skillName: string | null
  skillInput: Record<string, unknown> | null
  toolHint: string | null
  toolInput: Record<string, unknown> | null
  createdAt: string
}

interface StepRunResponse {
  id: string
  runId: string
  planStepId: string
  executionOrder: number
  status: StepRunDetail['status']
  executorType: StepRunDetail['executorType']
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

interface ArtifactResponse {
  id: string
  runId: string
  type: ArtifactDetail['type']
  title: string
  content: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

interface TaskDetailResponse {
  task: TaskSummary
  revisions: TaskRevision[]
  runs: RunSummaryResponse[]
  currentRun: RunDetailResponse | null
}

export interface TaskEventLog {
  id: string
  taskId: string | null
  runId: string | null
  eventName: string
  payload: Record<string, unknown>
  createdAt: string
}

export interface FetchTaskEventsParams {
  runId?: string
  take?: number
  skip?: number
  afterCreatedAt?: string
  afterEventId?: string
}

function normalizeNumber(value: NumberLike): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function mapPlanStep(step: PlanStepResponse): PlanStep {
  return {
    ...step,
  }
}

function mapPlan(plan: PlanDetailResponse): PlanDetail {
  return {
    ...plan,
    steps: [...plan.steps]
      .sort((left, right) => left.stepIndex - right.stepIndex)
      .map(mapPlanStep),
  }
}

function mapStepRun(stepRun: StepRunResponse): StepRunDetail {
  return {
    ...stepRun,
  }
}

function mapArtifact(artifact: ArtifactResponse): ArtifactDetail {
  return {
    ...artifact,
  }
}

function mapRunSummary(run: RunSummaryResponse): RunSummary {
  return {
    ...run,
    inputTokens: run.inputTokens ?? null,
    modelName: run.modelName ?? null,
    outputTokens: run.outputTokens ?? null,
    totalTokens: run.totalTokens ?? null,
    estimatedCostUsd: normalizeNumber(run.estimatedCostUsd),
  }
}

function mapRunDetail(run: RunDetailResponse): RunDetail {
  return {
    ...mapRunSummary(run),
    taskId: run.taskId,
    plans: [...run.plans].sort((left, right) => right.version - left.version).map(mapPlan),
    stepRuns: [...run.stepRuns]
      .sort((left, right) => left.executionOrder - right.executionOrder)
      .map(mapStepRun),
    artifacts: [...run.artifacts]
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      )
      .map(mapArtifact),
  }
}

function mapTaskDetail(response: TaskDetailResponse): TaskDetail {
  return {
    task: response.task,
    revisions: [...response.revisions].sort((left, right) => right.version - left.version),
    runs: [...response.runs]
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      )
      .map(mapRunSummary),
    currentRun: response.currentRun ? mapRunDetail(response.currentRun) : null,
  }
}

export async function fetchTasks() {
  const { data } = await apiClient.get<TaskSummary[]>('/tasks')
  return data
}

export type ApprovalMode = 'none' | 'plan_first' | 'side_effects' | 'all_steps'

export async function createTask(input: string, approvalMode: ApprovalMode = 'none') {
  const { data } = await apiClient.post<TaskSummary>('/tasks', { input, approvalMode })
  return data
}

export async function cloneTask(taskId: string) {
  const { data } = await apiClient.post<TaskSummary>(`/tasks/${taskId}/clone`)
  return data
}

export async function approveRun(taskId: string, runId: string) {
  await apiClient.post(`/tasks/${taskId}/runs/${runId}/approve`)
}

export async function rejectRun(taskId: string, runId: string) {
  await apiClient.post(`/tasks/${taskId}/runs/${runId}/reject`)
}

export async function fetchTaskDetail(taskId: string) {
  const { data } = await apiClient.get<TaskDetailResponse>(`/tasks/${taskId}/detail`)
  return mapTaskDetail(data)
}

export async function fetchRunDetail(taskId: string, runId: string) {
  const { data } = await apiClient.get<RunDetailResponse>(`/tasks/${taskId}/runs/${runId}`)
  return mapRunDetail(data)
}

export async function fetchTaskEvents(
  taskId: string,
  params: FetchTaskEventsParams = {},
) {
  const { data } = await apiClient.get<TaskEventLog[]>(`/tasks/${taskId}/events`, {
    params: {
      runId: params.runId,
      take: params.take,
      skip: params.skip,
      after_created_at: params.afterCreatedAt,
      after_event_id: params.afterEventId,
    },
  })
  return data
}

export async function deleteTask(taskId: string) {
  await apiClient.delete(`/tasks/${taskId}`)
}

export async function cancelTask(taskId: string) {
  await apiClient.post(`/tasks/${taskId}/cancel`)
}

export async function retryTask(taskId: string) {
  await apiClient.post(`/tasks/${taskId}/retry`)
}

export async function editTask(taskId: string, input: string) {
  const { data } = await apiClient.put<TaskRevision>(`/tasks/${taskId}/edit`, {
    input,
  })
  return data
}
