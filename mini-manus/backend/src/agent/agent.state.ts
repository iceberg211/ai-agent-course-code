import { Annotation } from '@langchain/langgraph';
import type { ApprovalMode } from '@/common/enums';

export interface StepResult {
  stepRunId: string;
  description: string;
  resultSummary: string;
  /** Real tool/skill output (truncated), for subsequent steps to read */
  toolOutput?: string;
  executionOrder: number;
}

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
  toolInput?: Record<string, unknown> | null;
  subAgent?: string | null;
  objective?: string | null;
}

export interface PlanDef {
  planId: string;
  steps: PlanStepDef[];
}

export const AgentStateAnnotation = Annotation.Root({
  taskId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  runId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  userInput: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  approvalMode: Annotation<ApprovalMode>({
    reducer: (_, b) => b,
    default: () => 'none' as ApprovalMode,
  }),

  plan: Annotation<PlanDef | null>({ reducer: (_, b) => b, default: () => null }),
  stepIndex: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  intent: Annotation<TaskIntent>({
    reducer: (_, b) => b,
    default: () => 'general' as TaskIntent,
  }),

  stepResults: Annotation<StepResult[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),

  lastStepRunId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  lastOutput: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),

  retryCount: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  replanCount: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  executionOrder: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),

  error: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
});

export type AgentState = typeof AgentStateAnnotation.State;
