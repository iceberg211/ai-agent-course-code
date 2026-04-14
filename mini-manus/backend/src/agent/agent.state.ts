import { Annotation } from '@langchain/langgraph';
import type { ApprovalMode } from '@/common/enums';

export interface StepResult {
  stepRunId: string;
  description: string;
  resultSummary: string;
  /** 工具/Skill 的真实输出（截断），供后续步骤 Tool Calling 读取真实数据 */
  toolOutput?: string;
  executionOrder: number;
}

export interface EvaluationResult {
  decision: 'continue' | 'retry' | 'replan' | 'complete' | 'fail';
  reason: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

/** 意图路由结果，决定 Planner 使用哪种规划策略 */
export type TaskIntent =
  | 'code_generation'
  | 'research_report'
  | 'competitive_analysis'
  | 'content_writing'
  | 'general';

export interface PlanStepDef {
  stepIndex: number;
  description: string;
  skillName?: string | null;
  skillInput?: Record<string, unknown> | null;
  toolHint?: string | null;
  toolInput?: Record<string, unknown> | null; // Bug 2 fix: planner specifies exact tool input
}

export interface PlanDef {
  planId: string;
  steps: PlanStepDef[];
}

export const AgentStateAnnotation = Annotation.Root({
  taskId: Annotation<string>({ reducer: (_, b) => b }),
  runId: Annotation<string>({ reducer: (_, b) => b }),
  revisionInput: Annotation<string>({ reducer: (_, b) => b }),
  currentPlan: Annotation<PlanDef | null>({ reducer: (_, b) => b }),
  currentStepIndex: Annotation<number>({ reducer: (_, b) => b }),
  stepResults: Annotation<StepResult[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  replanCount: Annotation<number>({ reducer: (_, b) => b }),
  retryCount: Annotation<number>({ reducer: (_, b) => b }),
  evaluation: Annotation<EvaluationResult | null>({ reducer: (_, b) => b }),
  executionOrder: Annotation<number>({ reducer: (_, b) => b }),
  shouldStop: Annotation<boolean>({ reducer: (_, b) => b }),
  errorMessage: Annotation<string | null>({ reducer: (_, b) => b }),
  // Intent Router 输出，Planner 据此选择规划策略
  taskIntent: Annotation<TaskIntent>({
    reducer: (_, b) => b,
    default: () => 'general',
  }),
  // Router 输出的二级子类型（code_generation 下有 web_app/cli_tool 等）
  taskIntentSubType: Annotation<string>({
    reducer: (_, b) => b,
    default: () => '',
  }),
  // HITL: approval mode carried through the run
  approvalMode: Annotation<ApprovalMode>({
    reducer: (_, b) => b,
    default: () => 'none',
  }),
  // Bug 1 fix: pass step_run id and output through state so evaluator can read them
  lastStepRunId: Annotation<string>({
    reducer: (_, b) => b,
    default: () => '',
  }),
  lastStepOutput: Annotation<string>({
    reducer: (_, b) => b,
    default: () => '',
  }),
  // 预算感知规划：planner 据此控制步骤数量
  usedTokens: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  tokenBudget: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 100_000,
  }),
  // 并行 fan-out 结果收集（Send API 专用）
  // reducer 用 append，允许多个并行分支安全合并而不互相覆盖
  parallelStepOutputs: Annotation<
    Array<{ stepIndex: number; output: string; sources?: string[] }>
  >({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  // 并行分支索引：Send API fan-out 时标记当前分支是第几个（-1 = 非并行路径）
  parallelTopicIdx: Annotation<number>({
    reducer: (_, b) => b,
    default: () => -1,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
