import { TaskPlan, StepRun, Artifact } from '@/task/entities';
import { StepStatus, RunStatus, ArtifactType } from '@/common/enums';

export interface AgentCallbacks {
  savePlan(
    runId: string,
    steps: Array<{
      stepIndex: number;
      description: string;
      skillName?: string | null;
      skillInput?: Record<string, unknown> | null;
      toolHint?: string | null;
      toolInput?: Record<string, unknown> | null; // Bug 2 fix
    }>,
  ): Promise<TaskPlan>;
  createStepRun(
    runId: string,
    planStepId: string,
    executionOrder: number,
  ): Promise<StepRun>;
  updateStepRun(
    stepRunId: string,
    updates: Partial<
      Pick<
        StepRun,
        | 'status'
        | 'toolName'
        | 'toolInput'
        | 'toolOutput'
        | 'skillName'
        | 'skillTrace'
        | 'llmReasoning'
        | 'resultSummary'
        | 'errorMessage'
        | 'executorType'
        | 'startedAt'
        | 'completedAt'
      >
    >,
  ): Promise<void>;
  readCancelFlag(runId: string): Promise<boolean>;
  setRunStatus(
    runId: string,
    status: RunStatus,
    errorMessage?: string,
  ): Promise<void>;
  saveArtifact(
    runId: string,
    title: string,
    content: string,
    type?: ArtifactType,
    metadata?: Record<string, unknown> | null,
  ): Promise<Artifact>;
  /**
   * 读取当前 task 最近完成 run 的摘要，注入 Planner 作为参考记忆。
   * 返回空字符串表示没有历史记忆。
   */
  getRecentMemory(taskId: string): Promise<string>;
  /**
   * 将本次 run 的 token 用量和成本估算持久化到 task_runs 表。
   */
  saveTokenUsage(
    runId: string,
    stats: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number | null;
      modelName: string;
    },
  ): Promise<void>;
  /**
   * P24：保存节点级 LLM 调用明细到 llm_call_logs。
   */
  saveLlmCallLogs(
    runId: string,
    modelName: string,
    logs: Array<{
      nodeName: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number | null;
      durationMs: number | null;
    }>,
  ): Promise<void>;
  /** HITL: 将 run 状态切为 AWAITING_APPROVAL 并记录待审批步骤信息 */
  setRunAwaitingApproval(
    runId: string,
    stepInfo: Record<string, unknown>,
  ): Promise<void>;
  finalize(taskId: string): Promise<void>;
}

// Re-export StepStatus so callbacks consumers don't need a separate import
export { StepStatus };
