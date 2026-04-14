import { Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { interrupt } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { tool as lcTool } from '@langchain/core/tools';
import { toolCallingPrompt } from '@/prompts';
import { AgentState } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { runSubAgent } from '@/agent/subagents/react-subagent';
import { SubAgentRegistry } from '@/agent/subagents/subagent.registry';
import { ToolRegistry } from '@/tool/tool.registry';
import { SkillRegistry } from '@/skill/skill.registry';
import { WorkspaceService } from '@/workspace/workspace.service';
import { ExecutorType, StepStatus, RunStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';
import { Tool } from '@/tool/interfaces/tool.interface';
import { STEP_RESULTS_PLACEHOLDER } from '@/agent/nodes/planner.node';
import {
  DB_RESULT_SUMMARY_MAX,
  PROMPT_RETRY_HINT_MAX,
} from '@/common/constants/system-limits';

/**
 * 解析 skillInput 中的 __STEP_RESULTS__ 占位符（仅检查顶层字符串值）。
 * 确定性 workflow 用此机制实现步骤间数据传递：
 * planner 设置 { source_material: "__STEP_RESULTS__" }
 * executor 在运行时替换为前序步骤的真实输出摘要。
 */
export function resolveStepResultsPlaceholder(
  input: Record<string, unknown>,
  state: AgentState,
): Record<string, unknown> {
  const hasPlaceholder = Object.values(input).some(
    (v) => v === STEP_RESULTS_PLACEHOLDER,
  );
  if (!hasPlaceholder) return input;

  const summary = state.stepResults
    .map((s) => `${s.description}:\n${s.toolOutput ?? s.resultSummary}`)
    .join('\n\n');

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    resolved[key] = value === STEP_RESULTS_PLACEHOLDER ? summary : value;
  }
  return resolved;
}

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

/**
 * 把步骤的完整输出写到 workspace/.steps/ 目录（宽带数据通道）。
 * state 里只保留摘要（窄带），后续步骤的 Tool Calling 可通过 read_file 读取完整数据。
 * 写入失败不阻断主流程。
 */
async function persistStepOutput(
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
        {
          description,
          output,
          structuredData: structuredData ?? null,
          executionOrder,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch {
    // 写入失败不阻断主流程
  }
}

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

/** Tool Calling 自身的超时，避免决议阶段卡住 */
const TOOL_CALLING_TIMEOUT_MS = 30_000;

/**
 * 核心参数（URL、文件内容等）必须由 LLM 根据运行时上下文决定的工具集合。
 *
 * 这些工具的关键参数在规划时无法确定（URL 来自搜索结果、content 来自前序步骤）。
 * Tool Calling 失败时 **不可 fallback**，因为 Planner 的原始参数（example.com、'...' 等）
 * 即使格式合法也是错误值，执行它等价于幻觉输出。
 *
 * 不在此集合中的工具（think、github_search、download_file 等），
 * Planner 规划时已知正确参数（查询词、下载 URL），允许 fallback。
 */
const DYNAMIC_PARAM_TOOLS = new Set([
  'browse_url', // URL 必须来自前序搜索结果，Planner 无法预知
  'fetch_url_as_markdown', // 同上
  'write_file', // content 必须来自前序 LLM 输出
  'export_pdf', // content 同上
  // download_file 不在此：URL 通常由 Planner 直接指定（静态参数），可以 fallback
]);

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
      ? `\n\n⚠️ 这是第 ${state.retryCount + 1} 次尝试，上次失败原因：${state.lastStepOutput.slice(0, PROMPT_RETRY_HINT_MAX)}\n请使用不同的参数重试。`
      : '';

  if (signal.aborted) return { name: toolName, args: fallbackInput };

  try {
    const llmWithTool = llm.bindTools([lcToolDef]);
    // P2-1: AbortSignal 传给 LangChain invoke，让 SDK 尽量中止底层 HTTP 请求
    // 注意：部分 provider 不完全支持 signal，withTimeout 是额外的 Promise.race 兜底
    const messages = await toolCallingPrompt.formatMessages({
      revisionInput: state.revisionInput,
      stepDescription: step.description,
      stepContext,
      retryHint,
    });
    const response = await withTimeout(
      llmWithTool.invoke(messages, { signal }),
      TOOL_CALLING_TIMEOUT_MS,
    );

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
        return {
          name: toolCall.name,
          args: parsed.data as Record<string, unknown>,
        };
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

  // Fail-closed：动态参数工具 Tool Calling 失败后直接报错，不 fallback
  // 原因：这类工具的 URL/content 必须来自运行时上下文，Planner 的原始值必然错误
  if (DYNAMIC_PARAM_TOOLS.has(toolName)) {
    logger.error(
      `Tool Calling 失败且 ${toolName} 属于动态参数工具，不允许 fallback`,
    );
    throw new Error(
      `工具 ${toolName} 需要运行时参数（URL/内容等），Tool Calling 决议失败，无法继续执行。` +
        `请重试或重新规划任务步骤。`,
    );
  }

  // 非动态工具 fallback 时仍检查占位符
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

  logger.log(
    `Tool Calling 失败，fallback 到 Planner 原始参数（已校验无占位符）`,
  );
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
  subAgentRegistry?: SubAgentRegistry,
): Promise<Partial<AgentState>> {
  if (!state.currentPlan) throw new Error('No plan available');

  const step = state.currentPlan.steps[state.currentStepIndex];
  if (!step) throw new Error(`No step at index ${state.currentStepIndex}`);

  const usesSubAgent = Boolean(step.subAgent);
  const usesSkill =
    !usesSubAgent &&
    Boolean(step.skillName && skillRegistry.has(step.skillName));
  // evaluator 降级时 fallbackTool 优先（resource_unavailable 场景）
  const effectiveToolName =
    (state.evaluation?.metadata as Record<string, string> | undefined)
      ?.fallbackTool ??
    step.toolHint ??
    'think';

  logger.log(
    `step[${state.currentStepIndex}] ${
      usesSubAgent
        ? 'subagent:' + step.subAgent
        : usesSkill
          ? 'skill:' + step.skillName
          : 'tool:' + effectiveToolName
    } | ${step.description.slice(0, 60)}${state.retryCount > 0 ? ` (retry #${state.retryCount})` : ''}`,
  );

  // ─── HITL interrupt 检查 ──────────────────────────────────────────────────
  // 根据 approvalMode 决定是否在执行前暂停等待人工确认
  const isSideEffect = usesSubAgent
    ? (subAgentRegistry?.get(step.subAgent!)?.isSideEffect ??
      step.subAgent === 'writer')
    : usesSkill
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
    // DB 状态由外层 while loop 在检测到 __interrupt__ 后统一写入，
    // 不在此处调用 setRunAwaitingApproval —— 避免 resume 时节点重跑导致状态闪回。
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
    executorType:
      usesSubAgent || usesSkill ? ExecutorType.SKILL : ExecutorType.TOOL,
    skillName: usesSubAgent
      ? `subagent:${step.subAgent}`
      : usesSkill
        ? step.skillName
        : null,
    toolName: !usesSubAgent && !usesSkill ? effectiveToolName : null,
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

      // 解析确定性 workflow 的 __STEP_RESULTS__ 占位符
      const rawSkillInput = step.skillInput ?? {};
      const resolvedSkillInput = resolveStepResultsPlaceholder(
        rawSkillInput,
        state,
      );

      await withTimeout(
        (async () => {
          for await (const event of skill.execute(resolvedSkillInput, {
            tools: toolRegistry,
            llm,
            workspace,
            signal,
            soMethod,
            taskId: state.taskId,
            priorStepSummaries: state.stepResults.map((s) => s.description),
            remainingBudgetHint: state.tokenBudget - state.usedTokens,
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

      await persistStepOutput(
        workspace,
        state.taskId,
        state.executionOrder,
        step.skillName!,
        step.description,
        resultSummary,
        typeof finalOutput === 'object' && finalOutput !== null
          ? finalOutput
          : undefined,
      );

      return {
        executionOrder: state.executionOrder + 1,
        evaluation: null,
        lastStepRunId: stepRun.id,
        lastStepOutput: resultSummary,
      };
    } else if (usesSubAgent) {
      // ─── SubAgent 路径（createReactAgent 模式）────────────────────────────
      // 成熟社区方案：@langchain/langgraph/prebuilt createReactAgent
      // SubAgent 自主决定工具调用顺序，完成后返回最终输出。
      // researcher: 只有读工具（search + fetch），用于调研
      // writer:     只有写工具（write_file + export_pdf），用于生成文件交付物
      const subAgentName = step.subAgent!;

      // 解析目标描述中的 __STEP_RESULTS__ 占位符（writer 步骤需要前序调研结果）
      const rawObjective = step.objective ?? step.description;
      const resolvedObjective = rawObjective.includes(STEP_RESULTS_PLACEHOLDER)
        ? rawObjective.replace(
            STEP_RESULTS_PLACEHOLDER,
            state.stepResults.length > 0
              ? state.stepResults
                  .map(
                    (s) =>
                      `${s.description}:\n${s.toolOutput ?? s.resultSummary}`,
                  )
                  .join('\n\n')
              : '（无前序步骤结果）',
          )
        : rawObjective;

      eventPublisher.emit(TASK_EVENTS.STEP_PROGRESS, {
        taskId: state.taskId,
        runId: state.runId,
        stepRunId: stepRun.id,
        planStepId: stepRun.planStepId,
        message: `SubAgent [${subAgentName}] 启动中…`,
      });

      if (!subAgentRegistry) {
        throw new Error(
          `SubAgent step "${subAgentName}" 需要 SubAgentRegistry，但未注入。请检查 AgentModule 配置。`,
        );
      }
      const subAgentOutput = await withTimeout(
        runSubAgent(
          subAgentName,
          resolvedObjective,
          state.taskId,
          state.runId,
          stepRun.id,
          llm,
          toolRegistry,
          subAgentRegistry,
          eventPublisher,
          signal,
        ),
        skillTimeoutMs,
      );

      if (signal.aborted) throw new Error('cancelled');

      const subAgentSummary = subAgentOutput.slice(0, DB_RESULT_SUMMARY_MAX);

      await callbacks.updateStepRun(stepRun.id, {
        executorType: ExecutorType.SKILL,
        skillName: `subagent:${subAgentName}`,
        resultSummary: subAgentSummary,
        completedAt: new Date(),
      });

      await persistStepOutput(
        workspace,
        state.taskId,
        state.executionOrder,
        `subagent_${subAgentName}`,
        step.description,
        subAgentOutput,
      );

      return {
        executionOrder: state.executionOrder + 1,
        evaluation: null,
        lastStepRunId: stepRun.id,
        lastStepOutput: subAgentOutput,
      };
    } else {
      // ─── Tool 路径（Tool Calling）────────────────────────────────────────
      // LLM 根据步骤目标 + 前序结果生成真实参数，解决静态计划参数问题
      const toolName = effectiveToolName; // fallbackTool 优先（已在函数顶部解析）
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

      // P1-3：resolveToolCallViaLLM 可能耗时，resolve 后再次检查取消状态，
      // 防止 cancel 信号发出后仍然执行 side-effect 工具（write_file、export_pdf 等）
      if (signal.aborted) {
        throw new Error('cancelled');
      }

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
        ? toolResult.output.slice(0, DB_RESULT_SUMMARY_MAX)
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

      if (toolResult.success) {
        await persistStepOutput(
          workspace,
          state.taskId,
          state.executionOrder,
          toolName,
          step.description,
          toolResult.output,
          toolResult.structuredData,
        );
      }

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
