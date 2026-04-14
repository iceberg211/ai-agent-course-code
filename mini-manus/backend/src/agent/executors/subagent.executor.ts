import { Logger } from '@nestjs/common';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { AgentState } from '@/agent/agent.state';
import type { NodeContext } from '@/agent/agent.context';
import type { EventPublisher } from '@/event/event.publisher';
import { ExecutorType } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { DB_RESULT_SUMMARY_MAX } from '@/common/constants/system-limits';
import {
  withTimeout,
  persistStepOutput,
  resolveStepResultsInString,
} from './shared';

const logger = new Logger('SubAgentExecutor');

/** Bridges SubAgent internal tool calls to main EventPublisher + counts calls */
class SubAgentEventBridge extends BaseCallbackHandler {
  name = 'SubAgentEventBridge';
  private readonly toolNames = new Map<string, string>();
  /** Number of tool calls made by the SubAgent */
  toolCallCount = 0;

  constructor(
    private readonly publisher: EventPublisher,
    private readonly taskId: string,
    private readonly runId: string,
    private readonly stepRunId: string,
  ) {
    super();
  }

  override handleToolStart(
    _tool: Serialized,
    input: string,
    toolRunId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ) {
    const toolName = runName ?? 'unknown_tool';
    this.toolNames.set(toolRunId, toolName);
    this.toolCallCount++;
    let toolInput: Record<string, unknown>;
    try {
      toolInput = JSON.parse(input) as Record<string, unknown>;
    } catch {
      toolInput = { raw: input };
    }
    this.publisher.emit(TASK_EVENTS.TOOL_CALLED, {
      taskId: this.taskId,
      runId: this.runId,
      stepRunId: this.stepRunId,
      toolName,
      toolInput,
    });
  }

  override handleToolEnd(output: string, toolRunId: string) {
    const toolName = this.toolNames.get(toolRunId) ?? 'unknown_tool';
    this.toolNames.delete(toolRunId);
    this.publisher.emit(TASK_EVENTS.TOOL_COMPLETED, {
      taskId: this.taskId,
      runId: this.runId,
      stepRunId: this.stepRunId,
      toolName,
      toolOutput: typeof output === 'string' ? output : JSON.stringify(output),
      cached: false,
      error: null,
      errorCode: null,
    });
  }
}

export interface SubAgentExecutorResult {
  output: string;
}

export async function executeSubAgentStep(
  state: AgentState,
  ctx: NodeContext,
  step: { description: string; subAgent: string; objective?: string | null },
  stepRunId: string,
): Promise<SubAgentExecutorResult> {
  const def = ctx.subAgentRegistry.get(step.subAgent);
  if (!def) throw new Error(`Unknown SubAgent: ${step.subAgent}`);

  const rawObjective = step.objective ?? step.description;
  const resolvedObjective = resolveStepResultsInString(
    rawObjective,
    state.stepResults,
  );
  const injected = def.injectArgs ? def.injectArgs(state.taskId) : {};

  const tools = def.tools
    .filter((name) => ctx.toolRegistry.has(name))
    .map((name) => ctx.toolRegistry.getAsLangChainTool(name, injected));

  ctx.eventPublisher.emit(TASK_EVENTS.STEP_PROGRESS, {
    taskId: state.taskId,
    runId: state.runId,
    stepRunId,
    planStepId: '',
    message: `SubAgent [${step.subAgent}] 启动中…`,
  });

  const agent = createReactAgent({
    llm: ctx.llm,
    tools,
    messageModifier: def.systemPrompt,
  });
  const eventBridge = new SubAgentEventBridge(
    ctx.eventPublisher,
    state.taskId,
    state.runId,
    stepRunId,
  );

  const result = await withTimeout(
    agent.invoke(
      { messages: [new HumanMessage(resolvedObjective)] },
      { signal: ctx.signal, callbacks: [eventBridge] },
    ),
    ctx.skillTimeoutMs,
  );

  if (ctx.signal.aborted) throw new Error('cancelled');

  // Validate: researcher SubAgent must have called tools (not just hallucinated)
  if (!def.isSideEffect && eventBridge.toolCallCount === 0) {
    logger.warn(`SubAgent [${step.subAgent}] completed without calling any tools — likely hallucinated`);
    const errorOutput = `error (subagent_no_tool_calls): SubAgent [${step.subAgent}] 未调用任何搜索工具，直接凭记忆生成了内容。请重试，确保使用 web_search 获取实时信息。`;

    await ctx.callbacks.updateStepRun(stepRunId, {
      executorType: ExecutorType.SKILL,
      skillName: `subagent:${step.subAgent}`,
      resultSummary: errorOutput,
      errorMessage: errorOutput,
      completedAt: new Date(),
    });

    return { output: errorOutput };
  }

  const messages = result.messages;
  const lastMsg = messages[messages.length - 1];
  const content = lastMsg?.content;
  let output: string;
  if (typeof content === 'string') output = content;
  else if (Array.isArray(content))
    output = content
      .map((c: any) => (typeof c === 'string' ? c : (c.text ?? '')))
      .join('');
  else output = JSON.stringify(content ?? '');

  const summary = output.slice(0, DB_RESULT_SUMMARY_MAX);

  await ctx.callbacks.updateStepRun(stepRunId, {
    executorType: ExecutorType.SKILL,
    skillName: `subagent:${step.subAgent}`,
    resultSummary: summary,
    completedAt: new Date(),
  });

  await persistStepOutput(
    ctx.workspace,
    state.taskId,
    state.executionOrder,
    `subagent_${step.subAgent}`,
    step.description,
    output,
  );

  return { output };
}
