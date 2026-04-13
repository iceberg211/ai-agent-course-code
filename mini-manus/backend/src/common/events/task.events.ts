export const TASK_EVENTS = {
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  REVISION_CREATED: 'revision.created',
  RUN_STARTED: 'run.started',
  RUN_COMPLETED: 'run.completed',
  RUN_FAILED: 'run.failed',
  RUN_CANCELLED: 'run.cancelled',
  PLAN_GENERATING: 'plan.generating',
  PLAN_CREATED: 'plan.created',
  STEP_STARTED: 'step.started',
  STEP_PROGRESS: 'step.progress',
  STEP_COMPLETED: 'step.completed',
  STEP_FAILED: 'step.failed',
  TOOL_CALLED: 'tool.called',
  TOOL_COMPLETED: 'tool.completed',
  ARTIFACT_CREATED: 'artifact.created',
  RUN_TOKEN_USAGE: 'run.token_usage',
  RUN_AWAITING_APPROVAL: 'run.awaiting_approval',
} as const;

export type TaskEventName = (typeof TASK_EVENTS)[keyof typeof TASK_EVENTS];
