import { Logger } from '@nestjs/common';
import { tool as lcTool } from '@langchain/core/tools';
import { toolCallingPrompt } from '@/prompts';
import type { AgentState } from '@/agent/agent.state';
import type { NodeContext } from '@/agent/agent.context';
import type { Tool } from '@/tool/interfaces/tool.interface';
import { ExecutorType } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import {
  DB_RESULT_SUMMARY_MAX,
  PROMPT_RETRY_HINT_MAX,
} from '@/common/constants/system-limits';
import { withTimeout, persistStepOutput, attachRuntimeContext } from './shared';

const logger = new Logger('ToolExecutor');
const TOOL_CALLING_TIMEOUT_MS = 30_000;

/** Tools whose key parameters must come from runtime context — fail-closed on resolution failure */
const DYNAMIC_PARAM_TOOLS = new Set([
  'browse_url',
  'fetch_url_as_markdown',
  'write_file',
  'export_pdf',
]);

function toLangChainTool(t: Tool) {
  return lcTool(async () => '', {
    name: t.name,
    description: t.description,
    schema: t.schema,
  });
}

export interface ToolExecutorResult {
  output: string;
  structuredData?: unknown;
}

export async function executeToolStep(
  state: AgentState,
  ctx: NodeContext,
  step: {
    description: string;
    toolHint?: string | null;
    toolInput?: Record<string, unknown> | null;
  },
  stepRunId: string,
): Promise<ToolExecutorResult> {
  const toolName = step.toolHint ?? 'think';
  const plannerInput: Record<string, unknown> = step.toolInput ?? {
    thought: step.description,
  };

  const resolved = await resolveToolCallViaLLM(
    toolName,
    plannerInput,
    step,
    state,
    ctx,
  );
  if (ctx.signal.aborted) throw new Error('cancelled');

  const toolInput = attachRuntimeContext(
    resolved.args,
    state.taskId,
    state.runId,
  );

  ctx.eventPublisher.emit(TASK_EVENTS.TOOL_CALLED, {
    taskId: state.taskId,
    runId: state.runId,
    stepRunId,
    toolName,
    toolInput,
  });

  const toolResult = await withTimeout(
    ctx.toolRegistry.executeWithCache(toolName, toolInput),
    ctx.stepTimeoutMs,
  );

  ctx.eventPublisher.emit(TASK_EVENTS.TOOL_COMPLETED, {
    taskId: state.taskId,
    runId: state.runId,
    stepRunId,
    toolName,
    toolOutput: toolResult.success
      ? toolResult.output
      : (toolResult.error ?? toolResult.output),
    cached: toolResult.cached ?? false,
    error: toolResult.error ?? null,
    errorCode: toolResult.errorCode ?? null,
  });

  const failureContext = toolResult.success
    ? null
    : `error (${toolResult.errorCode ?? 'tool_execution_failed'}): ${toolResult.error ?? toolResult.output ?? '工具执行失败'}`;

  if (toolResult.success) {
    logger.log(
      `${toolName} ✓ ${toolResult.cached ? '(cached) ' : ''}${toolResult.output.slice(0, 80)}`,
    );
  } else {
    logger.warn(`${toolName} ✗ ${failureContext!.slice(0, 120)}`);
  }

  const resultSummary = toolResult.success
    ? toolResult.output.slice(0, DB_RESULT_SUMMARY_MAX)
    : failureContext!;

  await ctx.callbacks.updateStepRun(stepRunId, {
    executorType: ExecutorType.TOOL,
    toolName,
    toolInput,
    toolOutput: toolResult.output,
    resultSummary,
    errorMessage: toolResult.success ? null : (toolResult.error ?? null),
    completedAt: new Date(),
  });

  if (toolResult.success) {
    await persistStepOutput(
      ctx.workspace,
      state.taskId,
      state.executionOrder,
      toolName,
      step.description,
      toolResult.output,
      toolResult.structuredData,
    );
  }

  const output = toolResult.success ? toolResult.output : failureContext!;
  return { output, structuredData: toolResult.structuredData };
}

async function resolveToolCallViaLLM(
  toolName: string,
  fallbackInput: Record<string, unknown>,
  step: { description: string },
  state: AgentState,
  ctx: NodeContext,
): Promise<{ name: string; args: Record<string, unknown> }> {
  if (toolName === 'think') return { name: toolName, args: fallbackInput };
  if (!ctx.toolRegistry.has(toolName)) throw new Error(`未知工具: ${toolName}`);
  if (state.stepResults.length === 0)
    return { name: toolName, args: fallbackInput };

  const tool = ctx.toolRegistry.get(toolName);
  const lcToolDef = toLangChainTool(tool);
  const stepContext = state.stepResults
    .map(
      (s) =>
        `步骤 ${s.executionOrder + 1}: ${s.description}\n${s.toolOutput ? `工具输出: ${s.toolOutput}` : `结果: ${s.resultSummary}`}`,
    )
    .join('\n\n');
  const retryHint =
    state.retryCount > 0 && state.lastOutput
      ? `\n\n⚠️ 这是第 ${state.retryCount + 1} 次尝试，上次失败原因：${state.lastOutput.slice(0, PROMPT_RETRY_HINT_MAX)}\n请使用不同的参数重试。`
      : '';

  if (ctx.signal.aborted) return { name: toolName, args: fallbackInput };

  try {
    const llmWithTool = ctx.llm.bindTools([lcToolDef]);
    const messages = await toolCallingPrompt.formatMessages({
      revisionInput: state.userInput,
      stepDescription: step.description,
      stepContext,
      retryHint,
    });
    const response = await withTimeout(
      llmWithTool.invoke(messages, { signal: ctx.signal }),
      TOOL_CALLING_TIMEOUT_MS,
    );
    const toolCall = response.tool_calls?.[0];
    if (toolCall && toolCall.name === toolName) {
      const argsWithRuntime = {
        ...(toolCall.args as Record<string, unknown>),
        task_id: state.taskId,
        run_id: state.runId,
      };
      const parsed = tool.schema.safeParse(argsWithRuntime);
      if (parsed.success) {
        logger.log(`Tool Calling 决议 ${toolName} 参数 ✓`);
        return {
          name: toolCall.name,
          args: parsed.data as Record<string, unknown>,
        };
      }
      logger.warn(`Tool Calling 参数校验失败，fallback`);
    }
  } catch (err) {
    logger.warn(
      `Tool Calling 失败: ${err instanceof Error ? err.message : err}`,
    );
  }

  if (DYNAMIC_PARAM_TOOLS.has(toolName)) {
    throw new Error(
      `工具 ${toolName} 需要运行时参数，Tool Calling 决议失败，无法继续执行。`,
    );
  }

  const suspicious = Object.entries(fallbackInput).filter(
    ([, v]) =>
      typeof v === 'string' &&
      (v.includes('example.com') || v === '...' || v.trim() === ''),
  );
  if (suspicious.length > 0) {
    throw new Error(
      `工具 ${toolName} 参数决议失败：字段 ${suspicious.map(([k]) => k).join(', ')} 为占位符`,
    );
  }

  return { name: toolName, args: fallbackInput };
}
