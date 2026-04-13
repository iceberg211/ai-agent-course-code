import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  fetchTaskEvents,
  type TaskEventLog,
} from '@/core/api/task.api'
import { queryKeys } from '@/core/api/query-keys'
import {
  acquireTaskSocket,
  getTaskSocket,
  releaseTaskSocket,
} from '@/core/socket/socket-client'
import { TASK_EVENTS } from '@/core/socket/task-events'
import type { LiveRunFeed, LiveStepFeed, PendingApproval, TokenUsage } from '@/domains/run/types/run.types'
import type { TaskDetail } from '@/domains/task/types/task.types'
import type { ExecutorType, RunStatus } from '@/shared/types/status'

// ─── Payload types ────────────────────────────────────────────────────────────

interface BasePayload {
  taskId?: string
  runId?: string
  _eventId?: string
  _eventName?: string
  _eventCreatedAt?: string
  errorCode?: string | null
  metadata?: Record<string, unknown> | null
}
interface RunFailedPayload extends BasePayload {
  error?: string
  budget?: number
  usedTokens?: number
  estimatedCostUsd?: number | null
}
interface StepStartedPayload extends BasePayload {
  stepRunId?: string
  planStepId?: string
  description?: string
  executorType?: ExecutorType
  skillName?: string | null
  toolName?: string | null
}
interface StepProgressPayload extends BasePayload {
  stepRunId?: string
  planStepId?: string
  message?: string
}
interface StepCompletedPayload extends BasePayload {
  stepRunId?: string
  resultSummary?: string
}
interface StepFailedPayload extends BasePayload {
  stepRunId?: string
  error?: string
}
interface ToolCalledPayload extends BasePayload {
  stepRunId?: string
  toolName?: string
  toolInput?: Record<string, unknown> | null
}
interface ToolCompletedPayload extends BasePayload {
  stepRunId?: string
  toolName?: string
  toolOutput?: string | null
  cached?: boolean
  error?: string | null
  errorCode?: string | null
}
interface PlanCreatedPayload extends BasePayload {
  version?: number
}
interface ArtifactCreatedPayload extends BasePayload {
  title?: string
}
interface RunTokenUsagePayload extends BasePayload {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  estimatedCostUsd?: number | null
}

// ─── Live feed helpers ────────────────────────────────────────────────────────

type LiveRunFeedMap = Record<string, LiveRunFeed>

function nowIso() {
  return new Date().toISOString()
}

function makeStep(
  stepRunId: string,
  receivedAt: string,
  partial?: Partial<LiveStepFeed>,
): LiveStepFeed {
  return {
    stepRunId,
    planStepId: partial?.planStepId ?? null,
    description: partial?.description ?? '正在执行步骤',
    status: partial?.status ?? 'running',
    executorType: partial?.executorType ?? null,
    skillName: partial?.skillName ?? null,
    toolName: partial?.toolName ?? null,
    startedAt: partial?.startedAt ?? receivedAt,
    completedAt: partial?.completedAt ?? null,
    resultSummary: partial?.resultSummary ?? null,
    errorMessage: partial?.errorMessage ?? null,
    progressMessages: partial?.progressMessages ?? [],
    toolCalls: partial?.toolCalls ?? [],
  }
}

function makeRunFeed(
  taskId: string,
  runId: string,
  receivedAt: string,
  current?: LiveRunFeed,
): LiveRunFeed {
  return {
    taskId,
    runId,
    runStatus: current?.runStatus ?? 'pending',
    latestNarration: current?.latestNarration ?? null,
    startedAt: current?.startedAt ?? null,
    lastEventAt: current?.lastEventAt ?? receivedAt,
    activeStepRunId: current?.activeStepRunId ?? null,
    stepOrder: current?.stepOrder ?? [],
    steps: current?.steps ?? {},
    tokenUsage: current?.tokenUsage ?? null,
    pendingApproval: current?.pendingApproval ?? null,
    terminalErrorCode: current?.terminalErrorCode ?? null,
    terminalErrorMetadata: current?.terminalErrorMetadata ?? null,
  }
}

function addStepOrder(stepOrder: string[], stepRunId: string) {
  return stepOrder.includes(stepRunId) ? stepOrder : [...stepOrder, stepRunId]
}

function trimProgressMessages(messages: string[]) {
  return messages.slice(-4)
}

function getUnixTime(iso: string | null | undefined) {
  if (!iso) return 0
  return new Date(iso).getTime()
}

/** PostgreSQL decimal 字段经 WebSocket snapshot 时以字符串形式到达，需转为 number */
function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function normalizeRunNumbers<T extends { inputTokens?: unknown; outputTokens?: unknown; totalTokens?: unknown; estimatedCostUsd?: unknown }>(run: T) {
  return {
    ...run,
    inputTokens: toNum(run.inputTokens),
    outputTokens: toNum(run.outputTokens),
    totalTokens: toNum(run.totalTokens),
    estimatedCostUsd: toNum(run.estimatedCostUsd),
  }
}

function normalizeSnapshot(snapshot: TaskDetail): TaskDetail {
  const revisions = [...snapshot.revisions].sort((left, right) => right.version - left.version)
  const runs = [...snapshot.runs]
    .sort((left, right) => getUnixTime(right.createdAt) - getUnixTime(left.createdAt))
    .map(normalizeRunNumbers)
  const currentRun = snapshot.currentRun
    ? {
        ...normalizeRunNumbers(snapshot.currentRun),
        plans: [...snapshot.currentRun.plans]
          .sort((left, right) => right.version - left.version)
          .map((plan) => ({
            ...plan,
            steps: [...plan.steps].sort((left, right) => left.stepIndex - right.stepIndex),
          })),
        stepRuns: [...snapshot.currentRun.stepRuns].sort(
          (left, right) => left.executionOrder - right.executionOrder,
        ),
        artifacts: [...snapshot.currentRun.artifacts].sort(
          (left, right) => getUnixTime(right.createdAt) - getUnixTime(left.createdAt),
        ),
      }
    : null

  return {
    ...snapshot,
    revisions,
    runs,
    currentRun,
  }
}

/**
 * 更新 liveRunFeeds map 里指定 runId 的 feed。
 * 不改其他 run 的 feed，返回新引用。
 */
function patchFeed(
  current: LiveRunFeedMap,
  taskId: string | undefined,
  runId: string | undefined,
  updater: (feed: LiveRunFeed, receivedAt: string) => LiveRunFeed,
): LiveRunFeedMap {
  if (!taskId || !runId) return current
  const receivedAt = nowIso()
  const feed = makeRunFeed(taskId, runId, receivedAt, current[runId])
  return {
    ...current,
    [runId]: { ...updater(feed, receivedAt), taskId, runId, lastEventAt: receivedAt },
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTaskSocketSync(
  selectedTaskId: string | null,
  selectedRunId: string | null,
) {
  const queryClient = useQueryClient()
  const [liveRunFeeds, setLiveRunFeeds] = useState<LiveRunFeedMap>({})
  const seenEventIdsRef = useRef<Set<string>>(new Set())
  // 用 lazy initializer 读取初始连接状态，避免在 effect 内同步 setState
  const [socketConnected, setSocketConnected] = useState(() => getTaskSocket().connected)

  const markEventSeen = useEffectEvent((payload: BasePayload | null | undefined) => {
    const eventId = payload?._eventId
    if (!eventId) return false
    if (seenEventIdsRef.current.has(eventId)) return true
    seenEventIdsRef.current.add(eventId)
    return false
  })

  // ── Query invalidation helpers ──────────────────────────────────────────────
  // 只在有意义的状态变更时刷新，而不是每个细粒度事件都刷新
  // - 细粒度事件（step.started / tool.called 等）只更新 liveRunFeed，不触发服务端请求
  // - 结构性变更（plan.created / step.completed / terminal）才刷新 React Query

  const invalidateTasks = useEffectEvent(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks() })
  })

  const invalidateDetail = useEffectEvent((payload?: BasePayload) => {
    if (!selectedTaskId) return
    void queryClient.invalidateQueries({ queryKey: queryKeys.taskDetail(selectedTaskId) })
    if (payload?.runId && payload.runId === selectedRunId) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runDetail(selectedTaskId, payload.runId),
      })
    }
  })

  const invalidateAll = useEffectEvent((payload?: BasePayload) => {
    invalidateTasks()
    invalidateDetail(payload)
  })

  // ── Snapshot (首次加入 room 时服务端推全量状态) ──────────────────────────────

  const handleSnapshot = useEffectEvent((snapshot: TaskDetail) => {
    if (!selectedTaskId || snapshot.task.id !== selectedTaskId) return
    const normalizedSnapshot = normalizeSnapshot(snapshot)
    queryClient.setQueryData(queryKeys.taskDetail(selectedTaskId), normalizedSnapshot)
    if (normalizedSnapshot.currentRun) {
      queryClient.setQueryData(
        queryKeys.runDetail(selectedTaskId, normalizedSnapshot.currentRun.id),
        normalizedSnapshot.currentRun,
      )
    }
  })

  // ── 结构性事件（需要刷新服务端数据） ──────────────────────────────────────

  const handleTaskCreated = useEffectEvent(() => {
    invalidateTasks()
  })

  const handleRevisionCreated = useEffectEvent((payload: BasePayload) => {
    invalidateAll(payload)
  })

  const handleRunStarted = useEffectEvent((payload: BasePayload) => {
    invalidateAll(payload)
    setLiveRunFeeds((cur) =>
      patchFeed(cur, payload.taskId, payload.runId, (feed, at) => ({
        ...feed,
        runStatus: 'running',
        startedAt: feed.startedAt ?? at,
        latestNarration: '任务开始执行，正在准备步骤…',
      })),
    )
  })

  const handlePlanCreated = useEffectEvent((payload: PlanCreatedPayload) => {
    invalidateDetail(payload) // 刷新 plan_steps
    setLiveRunFeeds((cur) =>
      patchFeed(cur, payload.taskId, payload.runId, (feed) => ({
        ...feed,
        latestNarration:
          payload.version != null
            ? `已生成 Plan v${payload.version}，开始逐步执行`
            : '已生成执行计划，开始逐步执行',
      })),
    )
  })

  // ── 步骤事件（只更新本地 live feed，不打服务端） ──────────────────────────

  const handleStepStarted = useEffectEvent((payload: StepStartedPayload) => {
    if (!payload.stepRunId) return
    setLiveRunFeeds((cur) =>
      patchFeed(cur, payload.taskId, payload.runId, (feed, at) => {
        const prev = feed.steps[payload.stepRunId!]
        const nextStep = makeStep(payload.stepRunId!, at, {
          ...prev,
          planStepId: payload.planStepId ?? prev?.planStepId ?? null,
          description: payload.description ?? prev?.description,
          status: 'running',
          executorType: payload.executorType ?? prev?.executorType ?? null,
          skillName: payload.skillName ?? prev?.skillName ?? null,
          toolName: payload.toolName ?? prev?.toolName ?? null,
          startedAt: prev?.startedAt ?? at,
          completedAt: null,
          errorMessage: null,
        })
        return {
          ...feed,
          runStatus: 'running',
          activeStepRunId: payload.stepRunId!,
          latestNarration: payload.description
            ? `开始执行：${payload.description}`
            : '开始执行新的步骤',
          stepOrder: addStepOrder(feed.stepOrder, payload.stepRunId!),
          steps: { ...feed.steps, [payload.stepRunId!]: nextStep },
        }
      }),
    )
  })

  const handleStepProgress = useEffectEvent((payload: StepProgressPayload) => {
    if (!payload.stepRunId || !payload.message) return
    setLiveRunFeeds((cur) =>
      patchFeed(cur, payload.taskId, payload.runId, (feed, at) => {
        const currentStep = makeStep(payload.stepRunId!, at, feed.steps[payload.stepRunId!])
        return {
          ...feed,
          runStatus: 'running',
          activeStepRunId: payload.stepRunId!,
          latestNarration: payload.message!,
          stepOrder: addStepOrder(feed.stepOrder, payload.stepRunId!),
          steps: {
            ...feed.steps,
            [payload.stepRunId!]: {
              ...currentStep,
              planStepId: payload.planStepId ?? currentStep.planStepId,
              progressMessages: trimProgressMessages([
                ...currentStep.progressMessages,
                payload.message!,
              ]),
            },
          },
        }
      }),
    )
  })

  const handleToolCalled = useEffectEvent((payload: ToolCalledPayload) => {
    if (!payload.stepRunId || !payload.toolName) return
    const { stepRunId, toolName } = payload
    setLiveRunFeeds((cur) =>
      patchFeed(cur, payload.taskId, payload.runId, (feed, at) => {
        const currentStep = makeStep(stepRunId, at, feed.steps[stepRunId])
        const callIndex =
          currentStep.toolCalls.filter((t) => t.toolName === toolName).length + 1
        return {
          ...feed,
          runStatus: 'running',
          activeStepRunId: stepRunId,
          latestNarration: `正在调用 ${toolName}`,
          stepOrder: addStepOrder(feed.stepOrder, stepRunId),
          steps: {
            ...feed.steps,
            [stepRunId]: {
              ...currentStep,
              toolCalls: [
                ...currentStep.toolCalls,
                {
                  id: `${stepRunId}:${toolName}:${callIndex}`,
                  toolName,
                  state: 'pending',
                  input: payload.toolInput ?? null,
                  output: null,
                  cached: false,
                  error: null,
                  errorCode: null,
                  startedAt: at,
                  completedAt: null,
                },
              ],
            },
          },
        }
      }),
    )
  })

  const handleToolCompleted = useEffectEvent((payload: ToolCompletedPayload) => {
    if (!payload.stepRunId || !payload.toolName) return
    const { stepRunId, toolName } = payload
    setLiveRunFeeds((cur) =>
      patchFeed(cur, payload.taskId, payload.runId, (feed, at) => {
        const currentStep = makeStep(stepRunId, at, feed.steps[stepRunId])
        const toolCalls = [...currentStep.toolCalls]
        // 找最后一个同名 pending call 更新为 completed
        const pendingIdx = [...toolCalls]
          .reverse()
          .findIndex((t) => t.toolName === toolName && t.state === 'pending')

        if (pendingIdx >= 0) {
          const realIdx = toolCalls.length - 1 - pendingIdx
          toolCalls[realIdx] = {
            ...toolCalls[realIdx],
            state: payload.error ? 'failed' : 'completed',
            output: payload.toolOutput ?? null,
            cached: payload.cached ?? false,
            error: payload.error ?? null,
            errorCode: payload.errorCode ?? null,
            completedAt: at,
          }
        } else {
          toolCalls.push({
            id: `${stepRunId}:${toolName}:${toolCalls.length + 1}`,
            toolName,
            state: payload.error ? 'failed' : 'completed',
            input: null,
            output: payload.toolOutput ?? null,
            cached: payload.cached ?? false,
            error: payload.error ?? null,
            errorCode: payload.errorCode ?? null,
            startedAt: at,
            completedAt: at,
          })
        }

        return {
          ...feed,
          latestNarration: payload.error ? `${toolName} 执行失败` : `已完成 ${toolName}`,
          steps: { ...feed.steps, [stepRunId]: { ...currentStep, toolCalls } },
        }
      }),
    )
  })

  const handleStepCompleted = useEffectEvent((payload: StepCompletedPayload) => {
    invalidateDetail(payload) // 步骤结果已写库，刷新一次
    if (!payload.stepRunId) return
    setLiveRunFeeds((cur) =>
      patchFeed(cur, payload.taskId, payload.runId, (feed, at) => {
        const currentStep = makeStep(payload.stepRunId!, at, feed.steps[payload.stepRunId!])
        return {
          ...feed,
          activeStepRunId:
            feed.activeStepRunId === payload.stepRunId ? null : feed.activeStepRunId,
          latestNarration:
            payload.resultSummary ?? `已完成：${currentStep.description || '当前步骤'}`,
          steps: {
            ...feed.steps,
            [payload.stepRunId!]: {
              ...currentStep,
              status: 'completed',
              resultSummary: payload.resultSummary ?? currentStep.resultSummary,
              completedAt: currentStep.completedAt ?? at,
            },
          },
        }
      }),
    )
  })

  const handleStepFailed = useEffectEvent((payload: StepFailedPayload) => {
    invalidateDetail(payload) // 步骤失败状态写库，刷新一次
    if (!payload.stepRunId) return
    setLiveRunFeeds((cur) =>
      patchFeed(cur, payload.taskId, payload.runId, (feed, at) => {
        const currentStep = makeStep(payload.stepRunId!, at, feed.steps[payload.stepRunId!])
        return {
          ...feed,
          activeStepRunId:
            feed.activeStepRunId === payload.stepRunId ? null : feed.activeStepRunId,
          latestNarration: payload.error ?? `步骤失败：${currentStep.description}`,
          steps: {
            ...feed.steps,
            [payload.stepRunId!]: {
              ...currentStep,
              status: 'failed',
              errorMessage: payload.error ?? currentStep.errorMessage,
              completedAt: currentStep.completedAt ?? at,
            },
          },
        }
      }),
    )
  })

  // ── Terminal 事件（刷新全量 + 更新 live feed） ─────────────────────────────

  const handleRunTerminal = useEffectEvent(
    (payload: BasePayload, runStatus: RunStatus, message: string) => {
      invalidateAll(payload)
      setLiveRunFeeds((cur) =>
        patchFeed(cur, payload.taskId, payload.runId, (feed) => ({
          ...feed,
          runStatus,
          activeStepRunId: null,
          latestNarration: message,
          terminalErrorCode: payload.errorCode ?? null,
          terminalErrorMetadata: payload.metadata ?? null,
        })),
      )
    },
  )

  const handleArtifactCreated = useEffectEvent((payload: ArtifactCreatedPayload) => {
    invalidateAll(payload) // 产物写库，刷新
    setLiveRunFeeds((cur) =>
      patchFeed(cur, payload.taskId, payload.runId, (feed) => ({
        ...feed,
        latestNarration: payload.title ? `已生成产物：${payload.title}` : '已生成新的任务产物',
      })),
    )
  })

  const handleRunTokenUsage = useEffectEvent((payload: RunTokenUsagePayload) => {
    invalidateDetail(payload)
    setLiveRunFeeds((cur) =>
      patchFeed(cur, payload.taskId, payload.runId, (feed) => ({
        ...feed,
        tokenUsage: {
          inputTokens: payload.inputTokens ?? 0,
          outputTokens: payload.outputTokens ?? 0,
          totalTokens: payload.totalTokens ?? 0,
          estimatedCostUsd: payload.estimatedCostUsd ?? null,
        } satisfies TokenUsage,
      })),
    )
  })

  const handleRunAwaitingApproval = useEffectEvent((payload: BasePayload & Record<string, unknown>) => {
    setLiveRunFeeds((cur) =>
      patchFeed(cur, payload.taskId, payload.runId, (feed) => ({
        ...feed,
        runStatus: 'awaiting_approval' as RunStatus,
        latestNarration: payload['type'] === 'plan_review' ? '计划已生成，等待审批后开始执行' : '步骤等待审批',
        pendingApproval: {
          type: (payload['type'] as 'plan_review' | 'step_review') ?? 'step_review',
          planId: payload['planId'] as string | undefined,
          stepCount: payload['stepCount'] as number | undefined,
          steps: payload['steps'] as PendingApproval['steps'],
          description: payload['description'] as string | undefined,
          toolOrSkill: payload['toolOrSkill'] as string | undefined,
          isSideEffect: payload['isSideEffect'] as boolean | undefined,
        },
      })),
    )
  })

  const applyLoggedEvent = useEffectEvent((event: TaskEventLog) => {
    const payload = {
      ...event.payload,
      _eventId:
        typeof event.payload._eventId === 'string' ? event.payload._eventId : event.id,
      _eventName:
        typeof event.payload._eventName === 'string'
          ? event.payload._eventName
          : event.eventName,
      _eventCreatedAt:
        typeof event.payload._eventCreatedAt === 'string'
          ? event.payload._eventCreatedAt
          : event.createdAt,
    } as BasePayload & Record<string, unknown>

    if (markEventSeen(payload)) return

    switch (event.eventName) {
      case TASK_EVENTS.taskCreated:
        handleTaskCreated()
        break
      case TASK_EVENTS.revisionCreated:
        handleRevisionCreated(payload)
        break
      case TASK_EVENTS.runStarted:
        handleRunStarted(payload)
        break
      case TASK_EVENTS.planCreated:
        handlePlanCreated(payload)
        break
      case TASK_EVENTS.stepStarted:
        handleStepStarted(payload)
        break
      case TASK_EVENTS.stepProgress:
        handleStepProgress(payload)
        break
      case TASK_EVENTS.toolCalled:
        handleToolCalled(payload)
        break
      case TASK_EVENTS.toolCompleted:
        handleToolCompleted(payload)
        break
      case TASK_EVENTS.stepCompleted:
        handleStepCompleted(payload)
        break
      case TASK_EVENTS.stepFailed:
        handleStepFailed(payload)
        break
      case TASK_EVENTS.runCompleted:
        handleRunTerminal(payload, 'completed', '本轮任务已完成')
        break
      case TASK_EVENTS.runFailed:
        handleRunTerminal(
          payload,
          'failed',
          typeof payload.error === 'string' ? payload.error : '本轮任务执行失败',
        )
        break
      case TASK_EVENTS.runCancelled:
        handleRunTerminal(payload, 'cancelled', '本轮任务已取消')
        break
      case TASK_EVENTS.artifactCreated:
        handleArtifactCreated(payload)
        break
      case TASK_EVENTS.runTokenUsage:
        handleRunTokenUsage(payload)
        break
      case TASK_EVENTS.runAwaitingApproval:
        handleRunAwaitingApproval(payload)
        break
      default:
        break
    }
  })

  // ── Socket 生命周期 ────────────────────────────────────────────────────────

  useEffect(() => {
    const socket = acquireTaskSocket()

    const onConnect = () => setSocketConnected(true)
    const onDisconnect = () => setSocketConnected(false)
    const withEventGuard =
      <T extends BasePayload>(handler: (payload: T) => void) =>
      (payload: T) => {
        if (markEventSeen(payload)) return
        handler(payload)
      }

    const onTaskCreated = withEventGuard(handleTaskCreated)
    const onRevisionCreated = withEventGuard(handleRevisionCreated)
    const onRunStarted = withEventGuard(handleRunStarted)
    const onPlanCreated = withEventGuard(handlePlanCreated)
    const onStepStarted = withEventGuard(handleStepStarted)
    const onStepProgress = withEventGuard(handleStepProgress)
    const onToolCalled = withEventGuard(handleToolCalled)
    const onToolCompleted = withEventGuard(handleToolCompleted)
    const onStepCompleted = withEventGuard(handleStepCompleted)
    const onStepFailed = withEventGuard(handleStepFailed)
    const onArtifactCreated = withEventGuard(handleArtifactCreated)
    const onRunTokenUsage = withEventGuard(handleRunTokenUsage)
    const onRunAwaitingApproval = withEventGuard(handleRunAwaitingApproval)
    const onRunCompleted = withEventGuard((p: BasePayload) =>
      handleRunTerminal(p, 'completed', '本轮任务已完成'),
    )
    const onRunFailed = (p: RunFailedPayload) =>
      withEventGuard((payload: RunFailedPayload) =>
        handleRunTerminal(payload, 'failed', payload.error ?? '本轮任务执行失败'),
      )(p)
    const onRunCancelled = withEventGuard((p: BasePayload) =>
      handleRunTerminal(p, 'cancelled', '本轮任务已取消'),
    )

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on(TASK_EVENTS.taskCreated, onTaskCreated)
    socket.on(TASK_EVENTS.revisionCreated, onRevisionCreated)
    socket.on(TASK_EVENTS.taskSnapshot, handleSnapshot)
    socket.on(TASK_EVENTS.runStarted, onRunStarted)
    socket.on(TASK_EVENTS.planCreated, onPlanCreated)
    socket.on(TASK_EVENTS.stepStarted, onStepStarted)
    socket.on(TASK_EVENTS.stepProgress, onStepProgress)
    socket.on(TASK_EVENTS.toolCalled, onToolCalled)
    socket.on(TASK_EVENTS.toolCompleted, onToolCompleted)
    socket.on(TASK_EVENTS.stepCompleted, onStepCompleted)
    socket.on(TASK_EVENTS.stepFailed, onStepFailed)
    socket.on(TASK_EVENTS.runCompleted, onRunCompleted)
    socket.on(TASK_EVENTS.runFailed, onRunFailed)
    socket.on(TASK_EVENTS.runCancelled, onRunCancelled)
    socket.on(TASK_EVENTS.artifactCreated, onArtifactCreated)
    socket.on(TASK_EVENTS.runTokenUsage, onRunTokenUsage)
    socket.on(TASK_EVENTS.runAwaitingApproval, onRunAwaitingApproval)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off(TASK_EVENTS.taskCreated, onTaskCreated)
      socket.off(TASK_EVENTS.revisionCreated, onRevisionCreated)
      socket.off(TASK_EVENTS.taskSnapshot, handleSnapshot)
      socket.off(TASK_EVENTS.runStarted, onRunStarted)
      socket.off(TASK_EVENTS.planCreated, onPlanCreated)
      socket.off(TASK_EVENTS.stepStarted, onStepStarted)
      socket.off(TASK_EVENTS.stepProgress, onStepProgress)
      socket.off(TASK_EVENTS.toolCalled, onToolCalled)
      socket.off(TASK_EVENTS.toolCompleted, onToolCompleted)
      socket.off(TASK_EVENTS.stepCompleted, onStepCompleted)
      socket.off(TASK_EVENTS.stepFailed, onStepFailed)
      socket.off(TASK_EVENTS.runCompleted, onRunCompleted)
      socket.off(TASK_EVENTS.runFailed, onRunFailed)
      socket.off(TASK_EVENTS.runCancelled, onRunCancelled)
      socket.off(TASK_EVENTS.artifactCreated, onArtifactCreated)
      socket.off(TASK_EVENTS.runTokenUsage, onRunTokenUsage)
      socket.off(TASK_EVENTS.runAwaitingApproval, onRunAwaitingApproval)
      setSocketConnected(false)
      releaseTaskSocket()
    }
  }, [])

  // ── 历史事件回放：刷新页面后补齐 live feed，并用 _eventId 与 Socket 去重 ─────

  useEffect(() => {
    seenEventIdsRef.current.clear()
    setLiveRunFeeds({})
  }, [selectedTaskId])

  useEffect(() => {
    if (!selectedTaskId) return
    let cancelled = false

    async function replayEvents() {
      try {
        const events = await fetchTaskEvents(selectedTaskId!, {
          runId: selectedRunId ?? undefined,
          take: 500,
        })
        if (cancelled) return
        for (const event of events) {
          applyLoggedEvent(event)
        }
      } catch (err) {
        console.warn('Failed to replay task events', err)
      }
    }

    void replayEvents()

    return () => {
      cancelled = true
    }
  }, [selectedTaskId, selectedRunId])

  // ── Task room 管理 ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedTaskId) return
    const socket = getTaskSocket()
    socket.emit('join:task', { taskId: selectedTaskId })
    return () => {
      socket.emit('leave:task', { taskId: selectedTaskId })
    }
  }, [selectedTaskId])

  // ── 返回当前选中 run 的 live feed ──────────────────────────────────────────

  const liveRunFeed = useMemo(
    () => (selectedRunId ? (liveRunFeeds[selectedRunId] ?? null) : null),
    [liveRunFeeds, selectedRunId],
  )

  return { liveRunFeed, socketConnected }
}
