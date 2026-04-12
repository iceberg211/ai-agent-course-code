import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/core/api/query-keys'
import {
  acquireTaskSocket,
  getTaskSocket,
  releaseTaskSocket,
} from '@/core/socket/socket-client'
import { TASK_EVENTS } from '@/core/socket/task-events'
import type { LiveRunFeed, LiveStepFeed, TokenUsage } from '@/domains/run/types/run.types'
import type { TaskDetail } from '@/domains/task/types/task.types'
import type { ExecutorType, RunStatus } from '@/shared/types/status'

// ─── Payload types ────────────────────────────────────────────────────────────

interface BasePayload {
  taskId?: string
  runId?: string
}
interface RunFailedPayload extends BasePayload {
  error?: string
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

function normalizeSnapshot(snapshot: TaskDetail): TaskDetail {
  const revisions = [...snapshot.revisions].sort((left, right) => right.version - left.version)
  const runs = [...snapshot.runs].sort(
    (left, right) => getUnixTime(right.createdAt) - getUnixTime(left.createdAt),
  )
  const currentRun = snapshot.currentRun
    ? {
        ...snapshot.currentRun,
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
  // 用 lazy initializer 读取初始连接状态，避免在 effect 内同步 setState
  const [socketConnected, setSocketConnected] = useState(() => getTaskSocket().connected)

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

  // ── Socket 生命周期 ────────────────────────────────────────────────────────

  useEffect(() => {
    const socket = acquireTaskSocket()

    const onConnect = () => setSocketConnected(true)
    const onDisconnect = () => setSocketConnected(false)
    const onRunCompleted = (p: BasePayload) => handleRunTerminal(p, 'completed', '本轮任务已完成')
    const onRunFailed = (p: RunFailedPayload) =>
      handleRunTerminal(p, 'failed', p.error ?? '本轮任务执行失败')
    const onRunCancelled = (p: BasePayload) => handleRunTerminal(p, 'cancelled', '本轮任务已取消')

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on(TASK_EVENTS.taskCreated, handleTaskCreated)
    socket.on(TASK_EVENTS.revisionCreated, handleRevisionCreated)
    socket.on(TASK_EVENTS.taskSnapshot, handleSnapshot)
    socket.on(TASK_EVENTS.runStarted, handleRunStarted)
    socket.on(TASK_EVENTS.planCreated, handlePlanCreated)
    socket.on(TASK_EVENTS.stepStarted, handleStepStarted)
    socket.on(TASK_EVENTS.stepProgress, handleStepProgress)
    socket.on(TASK_EVENTS.toolCalled, handleToolCalled)
    socket.on(TASK_EVENTS.toolCompleted, handleToolCompleted)
    socket.on(TASK_EVENTS.stepCompleted, handleStepCompleted)
    socket.on(TASK_EVENTS.stepFailed, handleStepFailed)
    socket.on(TASK_EVENTS.runCompleted, onRunCompleted)
    socket.on(TASK_EVENTS.runFailed, onRunFailed)
    socket.on(TASK_EVENTS.runCancelled, onRunCancelled)
    socket.on(TASK_EVENTS.artifactCreated, handleArtifactCreated)
    socket.on(TASK_EVENTS.runTokenUsage, handleRunTokenUsage)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off(TASK_EVENTS.taskCreated, handleTaskCreated)
      socket.off(TASK_EVENTS.revisionCreated, handleRevisionCreated)
      socket.off(TASK_EVENTS.taskSnapshot, handleSnapshot)
      socket.off(TASK_EVENTS.runStarted, handleRunStarted)
      socket.off(TASK_EVENTS.planCreated, handlePlanCreated)
      socket.off(TASK_EVENTS.stepStarted, handleStepStarted)
      socket.off(TASK_EVENTS.stepProgress, handleStepProgress)
      socket.off(TASK_EVENTS.toolCalled, handleToolCalled)
      socket.off(TASK_EVENTS.toolCompleted, handleToolCompleted)
      socket.off(TASK_EVENTS.stepCompleted, handleStepCompleted)
      socket.off(TASK_EVENTS.stepFailed, handleStepFailed)
      socket.off(TASK_EVENTS.runCompleted, onRunCompleted)
      socket.off(TASK_EVENTS.runFailed, onRunFailed)
      socket.off(TASK_EVENTS.runCancelled, onRunCancelled)
      socket.off(TASK_EVENTS.artifactCreated, handleArtifactCreated)
      socket.off(TASK_EVENTS.runTokenUsage, handleRunTokenUsage)
      setSocketConnected(false)
      releaseTaskSocket()
    }
  }, [])

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
