import * as fs from 'fs/promises';
import * as path from 'path';
import type { WorkspaceService } from '@/workspace/workspace.service';
import type { StepResult } from '@/agent/agent.state';
import { STEP_RESULTS_PLACEHOLDER } from '@/agent/intent.config';

/** Add timeout to any promise */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`步骤执行超时（${ms / 1000}s）`)), ms),
    ),
  ]);
}

/** Write full step output to workspace for later read_file access */
export async function persistStepOutput(
  workspace: WorkspaceService,
  taskId: string,
  executionOrder: number,
  executorName: string,
  description: string,
  output: string,
  structuredData?: unknown,
): Promise<void> {
  try {
    const safeName = executorName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `.steps/step_${executionOrder}_${safeName}.json`;
    const safePath = workspace.resolveSafePath(taskId, fileName);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(
      safePath,
      JSON.stringify(
        { description, output, structuredData: structuredData ?? null, executionOrder, timestamp: new Date().toISOString() },
        null, 2,
      ),
      'utf8',
    );
  } catch {
    // Write failure must not block main flow
  }
}

/** Resolve __STEP_RESULTS__ placeholder in a string */
export function resolveStepResultsInString(
  text: string,
  stepResults: StepResult[],
): string {
  if (!text.includes(STEP_RESULTS_PLACEHOLDER)) return text;
  const summary = stepResults.length > 0
    ? stepResults.map(s => `${s.description}:\n${s.toolOutput ?? s.resultSummary}`).join('\n\n')
    : '（无前序步骤结果）';
  return text.replace(STEP_RESULTS_PLACEHOLDER, summary);
}

/** Resolve __STEP_RESULTS__ placeholder in Record values */
export function resolveStepResultsInRecord(
  input: Record<string, unknown>,
  stepResults: StepResult[],
): Record<string, unknown> {
  const hasPlaceholder = Object.values(input).some(v => v === STEP_RESULTS_PLACEHOLDER);
  if (!hasPlaceholder) return input;
  const summary = stepResults.length > 0
    ? stepResults.map(s => `${s.description}:\n${s.toolOutput ?? s.resultSummary}`).join('\n\n')
    : '（无前序步骤结果）';
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    resolved[key] = value === STEP_RESULTS_PLACEHOLDER ? summary : value;
  }
  return resolved;
}

/** Inject task_id and run_id into tool input if missing */
export function attachRuntimeContext(
  input: Record<string, unknown>,
  taskId: string,
  runId: string,
): Record<string, unknown> {
  return { ...input, task_id: input.task_id ?? taskId, run_id: input.run_id ?? runId };
}
