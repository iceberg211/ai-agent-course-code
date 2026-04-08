import { TaskPlan, StepRun, Artifact } from '@/task/entities';
import { StepStatus, RunStatus } from '@/common/enums';

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
  ): Promise<Artifact>;
  finalize(taskId: string): Promise<void>;
}

// Re-export StepStatus so callbacks consumers don't need a separate import
export { StepStatus };
