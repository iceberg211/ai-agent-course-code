import { Logger } from '@nestjs/common';
import { interrupt } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { tool as lcTool } from '@langchain/core/tools';
import { AgentState } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { ToolRegistry } from '@/tool/tool.registry';
import { SkillRegistry } from '@/skill/skill.registry';
import { WorkspaceService } from '@/workspace/workspace.service';
import { ExecutorType, StepStatus, RunStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';
import { Tool } from '@/tool/interfaces/tool.interface';

/** 给任意 Promise 加超时，超时视为可重试错误 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`步骤执行超时（${ms / 1000}s）`)), ms),
    ),
  ]);
}

const logger = new Logger('ExecutorNode');

function attachRuntimeToolContext(
  input: Record<string, unknown>,
  state: AgentState,
): Record<string, unknown> {
  const record = input;
  return {
    ...record,
    task_id: record.task_id ?? state.taskId,
    run_id: record.run_id ?? state.runId,
  };
}

// ─── Tool Calling：让 LLM 根据上下文生成真实的工具参数 ──────────────────────
// 解决 Planner 在规划时无法确定运行时数据（URL、文件内容等）的问题。
// 这是 ReAct / 多 Agent 的基础原语。

/** 将 ToolRegistry 中的 Tool 转成 LangChain bindTools 需要的格式 */
function toLangChainTool(t: Tool) {
  return lcTool(async () => '', {
    name: t.name,
    description: t.description,
    schema: t.schema,
  });
}

/**
 * 用 LLM Tool Calling 生成工具参数。
 * 如果 LLM 调用失败，fallback 到 Planner 原始参数。
 */
/** Tool Calling 自身的超时，避免决议阶段卡住 */
const TOOL_CALLING_TIMEOUT_MS = 30_000;

async function resolveToolCallViaLLM(
  toolName: string,
  fallbackInput: Record<string, unknown>,
  step: { description: string },
  state: AgentState,
  llm: ChatOpenAI,
  toolRegistry: ToolRegistry,
  signal: AbortSignal,
): Promise<{ name: string; args: Record<string, unknown> }> {
  // think 工具不需要 LLM 决议
  if (toolName === 'think') {
    return { name: toolName, args: fallbackInput };
  }

  // 工具不存在时直接报错，不走 Tool Calling
  if (!toolRegistry.has(toolName)) {
    logger.error(`工具 ${toolName} 不存在于 registry`);
    throw new Error(`未知工具: ${toolName}`);
  }

  // 没有前序步骤结果时，无上下文可决议，直接用原始参数
  if (state.stepResults.length === 0) {
    return { name: toolName, args: fallbackInput };
  }

  const tool = toolRegistry.get(toolName);
  const lcToolDef = toLangChainTool(tool);

  const stepContext = state.stepResults
    .map(
      (s) =>
        `步骤 ${s.executionOrder + 1}: ${s.description}\n` +
        (s.toolOutput
          ? `工具输出: ${s.toolOutput}`
          : `结果: ${s.resultSummary}`),
    )
    .join('\n\n');

  // 重试时带上前次失败原因，让 LLM 选择不同参数（如换一个 URL）
  const retryHint =
    state.retryCount > 0 && state.lastStepOutput
      ? `\n\n⚠️ 这是第 ${state.retryCount + 1} 次尝试，上次失败原因：${state.lastStepOutput.slice(0, 500)}\n请使用不同的参数重试。`
      : '';

  if (signal.aborted) return { name: toolName, args: fallbackInput };

  try {
    const llmWithTool = llm.bindTools([lcToolDef]);
    const response = await withTimeout(llmWithTool.invoke([
      new SystemMessage(
        '你是一个工具调用助手。根据步骤目标和前序步骤的执行结果，调用指定工具并填入正确参数。' +
          '必须调用工具，不要只回复文字。',
      ),
      new HumanMessage(
        `任务目标：${state.revisionInput}\n` +
          `当前步骤：${step.description}\n\n` +
          `前序步骤结果：\n${stepContext}${retryHint}`,
      ),
    ]), TOOL_CALLING_TIMEOUT_MS);

    const toolCall = response.tool_calls?.[0];
    if (toolCall && toolCall.name === toolName) {
      // P1-3 fix: 先注入 runtime 字段再校验，因为 LLM 不负责生成 task_id/run_id
      const argsWithRuntime = {
        ...(toolCall.args as Record<string, unknown>),
        task_id: state.taskId,
        run_id: state.runId,
      };
      const parsed = tool.schema.safeParse(argsWithRuntime);
      if (parsed.success) {
        logger.log(`Tool Calling 决议 ${toolName} 参数 ✓`);
        return { name: toolCall.name, args: parsed.data as Record<string, unknown> };
      }
      logger.warn(
        `Tool Calling 参数校验失败: ${parsed.error.issues.map((i) => i.message).join('; ')}，fallback`,
      );
    } else {
      logger.warn(`Tool Calling 未返回有效 tool_call for ${toolName}`);
    }
  } catch (err) {
    logger.warn(
      `Tool Calling 失败: ${err instanceof Error ? err.message : err}`,
    );
  }

  // C3 fix: fallback 时检查原始参数质量，有占位符则明确报错而非静默执行
  const suspicious = Object.entries(fallbackInput).filter(
    ([, v]) =>
      typeof v === 'string' &&
      (v.includes('example.com') || v === '...' || v.trim() === ''),
  );
  if (suspicious.length > 0) {
    const fields = suspicious.map(([k]) => k).join(', ');
    logger.error(
      `Tool Calling 失败且 fallback 参数含占位符 [${fields}]，标记步骤失败`,
    );
    throw new Error(
      `工具 ${toolName} 参数决议失败：字段 ${fields} 为占位符，无法执行`,
    );
  }

  logger.log(`Tool Calling 失败，fallback 到 Planner 原始参数（已校验无占位符）`);
  return { name: toolName, args: fallbackInput };
}

export async function executorNode(
  state: AgentState,
  llm: ChatOpenAI,
  toolRegistry: ToolRegistry,
  skillRegistry: SkillRegistry,
  workspace: WorkspaceService,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
  signal: AbortSignal,
  stepTimeoutMs: number,
  skillTimeoutMs: number,
  soMethod: 'functionCalling' | 'json_schema' | 'jsonMode' = 'functionCalling',
): Promise<Partial<AgentState>> {
  if (!state.currentPlan) throw new Error('No plan available');

  const step = state.currentPlan.steps[state.currentStepIndex];
  if (!step) throw new Error(`No step at index ${state.currentStepIndex}`);

  const usesSkill = Boolean(
    step.skillName && skillRegistry.has(step.skillName),
  );

  logger.log(
    `step[${state.currentStepIndex}] ${usesSkill ? 'skill:' + step.skillName : 'tool:' + (step.toolHint ?? 'think')} | ${step.description.slice(0, 60)}${state.retryCount > 0 ? ` (retry #${state.retryCount})` : ''}`,
  );

  // ─── HITL interrupt 检查 ──────────────────────────────────────────────────
  // 根据 approvalMode 决定是否在执行前暂停等待人工确认
  const isSideEffect = usesSkill
    ? skillRegistry.get(step.skillName!).effect === 'side-effect'
    : toolRegistry.has(step.toolHint ?? '')
      ? toolRegistry.get(step.toolHint!).type === 'side-effect'
      : false;

  const shouldPause =
    state.approvalMode === 'all_steps' ||
    (state.approvalMode === 'side_effects' && isSideEffect);

  if (shouldPause) {
    const stepInfo = {
      stepIndex: state.currentStepIndex,
      description: step.description,
      isSideEffect,
      toolOrSkill: step.toolHint ?? step.skillName ?? 'unknown',
    };
    // 持久化 AWAITING_APPROVAL 状态（在 interrupt 之前，防止状态丢失）
    await callbacks.setRunAwaitingApproval(state.runId, stepInfo);

    // LangGraph interrupt：暂停图执行，等待外部 resume
    const decision = interrupt(stepInfo);

    // resume 后恢复执行
    await callbacks.setRunStatus(state.runId, RunStatus.RUNNING);
    if (decision === 'rejected') {
      return { shouldStop: true, errorMessage: 'step_rejected' };
    }
  }

  // 先持久化 step_run，再发事件，避免前端收到数据库里不存在的记录
  const stepRun = await callbacks.createStepRun(
    state.runId,
    `${state.currentPlan.planId}:${step.stepIndex}`,
    state.executionOrder,
  );
  await callbacks.updateStepRun(stepRun.id, {
    startedAt: new Date(),
    status: StepStatus.RUNNING,
  });

  eventPublisher.emit(TASK_EVENTS.STEP_STARTED, {
    taskId: state.taskId,
    runId: state.runId,
    stepRunId: stepRun.id,
    planStepId: stepRun.planStepId,
    description: step.description,
    executorType: usesSkill ? ExecutorType.SKILL : ExecutorType.TOOL,
    skillName: usesSkill ? step.skillName : null,
    toolName: usesSkill ? null : (step.toolHint ?? 'think'),
  });

  try {
    if (usesSkill) {
      // ─── Skill 路径 ──────────────────────────────────────────────────────
      const skill = skillRegistry.get(step.skillName!);
      const skillTrace: Array<{
        tool: string;
        input: unknown;
        output: string;
      }> = [];
      let finalOutput: unknown = null;

      await withTimeout(
        (async () => {
          for await (const event of skill.execute(step.skillInput ?? {}, {
            tools: toolRegistry,
            llm,
            workspace,
            signal,
            soMethod,
          })) {
            if (event.type === 'tool_call') {
              eventPublisher.emit(TASK_EVENTS.TOOL_CALLED, {
                taskId: state.taskId,
                runId: state.runId,
                stepRunId: stepRun.id,
                toolName: event.tool,
                toolInput: event.input as Record<string, unknown>,
              });
              skillTrace.push({
                tool: event.tool,
                input: event.input,
                output: '',
              });
            } else if (event.type === 'tool_result') {
              if (skillTrace.length > 0) {
                skillTrace[skillTrace.length - 1].output = event.output;
              }
              eventPublisher.emit(TASK_EVENTS.TOOL_COMPLETED, {
                taskId: state.taskId,
                runId: state.runId,
                stepRunId: stepRun.id,
                toolName: event.tool,
                toolOutput: event.output,
                cached: event.cached ?? false,
                error: event.error ?? null,
                errorCode: event.errorCode ?? null,
              });
            } else if (event.type === 'progress') {
              eventPublisher.emit(TASK_EVENTS.STEP_PROGRESS, {
                taskId: state.taskId,
                runId: state.runId,
                stepRunId: stepRun.id,
                planStepId: stepRun.planStepId,
                message: event.message,
              });
            } else if (event.type === 'result') {
              finalOutput = event.output;
            }

            if (signal.aborted) break;
          }
        })(),
        skillTimeoutMs,
      );

      const resultSummary =
        typeof finalOutput === 'string'
          ? finalOutput
          : JSON.stringify(finalOutput);

      await callbacks.updateStepRun(stepRun.id, {
        executorType: ExecutorType.SKILL,
        skillName: step.skillName,
        skillTrace,
        resultSummary,
        completedAt: new Date(),
      });

      return {
        executionOrder: state.executionOrder + 1,
        evaluation: null,
        lastStepRunId: stepRun.id,
        lastStepOutput: resultSummary,
      };
    } else {
      // ─── Tool 路径（Tool Calling）────────────────────────────────────────
      // LLM 根据步骤目标 + 前序结果生成真实参数，解决静态计划参数问题
      const toolName = step.toolHint ?? 'think';
      const plannerInput: Record<string, unknown> = step.toolInput ?? {
        thought: step.description,
      };
      const resolved = await resolveToolCallViaLLM(
        toolName,
        plannerInput,
        step,
        state,
        llm,
        toolRegistry,
        signal,
      );
      const toolInput = attachRuntimeToolContext(resolved.args, state);

      eventPublisher.emit(TASK_EVENTS.TOOL_CALLED, {
        taskId: state.taskId,
        runId: state.runId,
        stepRunId: stepRun.id,
        toolName,
        toolInput,
      });

      // read-only 工具走缓存（executeWithCache），side-effect 工具直接执行
      const toolResult = await withTimeout(
        toolRegistry.executeWithCache(toolName, toolInput),
        stepTimeoutMs,
      );

      eventPublisher.emit(TASK_EVENTS.TOOL_COMPLETED, {
        taskId: state.taskId,
        runId: state.runId,
        stepRunId: stepRun.id,
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
        ? toolResult.output.slice(0, 500)
        : failureContext;

      await callbacks.updateStepRun(stepRun.id, {
        executorType: ExecutorType.TOOL,
        toolName,
        toolInput,
        toolOutput: toolResult.output,
        resultSummary,
        errorMessage: toolResult.success ? null : (toolResult.error ?? null),
        completedAt: new Date(),
      });

      return {
        executionOrder: state.executionOrder + 1,
        evaluation: null,
        lastStepRunId: stepRun.id,
        lastStepOutput: toolResult.success
          ? toolResult.output
          : failureContext!,
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`step[${state.currentStepIndex}] 异常: ${msg.slice(0, 200)}`);
    await callbacks.updateStepRun(stepRun.id, {
      status: StepStatus.FAILED,
      errorMessage: msg,
      completedAt: new Date(),
    });
    return {
      executionOrder: state.executionOrder + 1,
      evaluation: { decision: 'retry', reason: msg },
      lastStepRunId: stepRun.id,
      lastStepOutput: msg,
    };
  }
}
