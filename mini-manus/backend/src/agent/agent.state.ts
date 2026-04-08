import { Annotation } from '@langchain/langgraph';

export interface StepResult {
  stepRunId: string;
  description: string;
  resultSummary: string;
  executionOrder: number;
}

export interface EvaluationResult {
  decision: 'continue' | 'retry' | 'replan' | 'complete' | 'fail';
  reason: string;
}

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
  // Bug 1 fix: pass step_run id and output through state so evaluator can read them
  lastStepRunId: Annotation<string>({
    reducer: (_, b) => b,
    default: () => '',
  }),
  lastStepOutput: Annotation<string>({
    reducer: (_, b) => b,
    default: () => '',
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
