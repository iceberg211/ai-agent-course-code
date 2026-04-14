import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { Command, END, interrupt, getStore } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AgentState, PlanDef, PlanStepDef, TaskIntent } from '@/agent/agent.state';
import { getCtx, type NodeContext } from '@/agent/agent.context';
import { getIntentConfig } from '@/agent/intent.config';
import { validatePlanSemantics, formatValidationErrors } from '@/agent/plan-validator';
import { buildGuardedPlannerChain } from '@/agent/guardrails/guardrail.chain';
import { GuardrailBlockedError } from '@/agent/guardrails/guardrail-blocked.error';
import { combinedPlannerPrompt, plannerPrompt, INTENT_GUIDANCE } from '@/prompts';
import { RunStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';

const logger = new Logger('PlannerNode');

const VALID_INTENTS: TaskIntent[] = [
  'code_generation', 'research_report', 'competitive_analysis', 'content_writing', 'general',
];

const CombinedPlannerSchema = z.object({
  intent: z.enum(VALID_INTENTS as [TaskIntent, ...TaskIntent[]]),
  steps: z.array(z.object({
    stepIndex: z.number().int().min(0),
    description: z.string().min(1),
    skillName: z.string().nullable().optional(),
    skillInput: z.any().optional(),
    toolHint: z.string().nullable().optional(),
    toolInput: z.any().optional(),
    subAgent: z.string().nullable().optional(),
    objective: z.string().nullable().optional(),
  })),
});

const ReplanSchema = z.object({
  steps: z.array(z.object({
    stepIndex: z.number().int().min(0),
    description: z.string().min(1),
    skillName: z.string().nullable().optional(),
    skillInput: z.any().optional(),
    toolHint: z.string().nullable().optional(),
    toolInput: z.any().optional(),
    subAgent: z.string().nullable().optional(),
    objective: z.string().nullable().optional(),
  })),
});

export async function plannerNode(
  state: AgentState,
  config: RunnableConfig,
): Promise<Command> {
  const ctx = getCtx(config);
  const isReplan = state.replanCount > 0;

  if (isReplan) {
    ctx.eventPublisher.emit(TASK_EVENTS.PLAN_GENERATING, {
      taskId: state.taskId, runId: state.runId, isReplan: true,
    });
  }

  let resolvedIntent: TaskIntent;
  let planSteps: PlanStepDef[];

  try {
    if (isReplan) {
      // ─── Replan: keep existing intent, use original plannerPrompt for re-planning ──
      resolvedIntent = state.intent;
      planSteps = await replan(state, ctx, config);
    } else {
      // ─── First run: classify intent + plan in one LLM call ─────────────────
      const result = await classifyAndPlan(state, ctx, config);
      if ('error' in result) {
        return new Command({ update: { error: result.error }, goto: END });
      }
      resolvedIntent = result.intent;

      // Check for deterministic workflow
      const intentConfig = getIntentConfig(resolvedIntent);
      if (intentConfig.workflowBuilder) {
        logger.log(`确定性 workflow: ${resolvedIntent}（跳过 LLM 规划步骤）`);
        planSteps = intentConfig.workflowBuilder(state, ctx);
      } else {
        planSteps = result.steps;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Planner failed: ${msg}`);
    return new Command({ update: { error: msg }, goto: END });
  }

  // ─── Persist plan ──────────────────────────────────────────────────────
  const plan = await ctx.callbacks.savePlan(state.runId, planSteps);
  ctx.eventPublisher.emit(TASK_EVENTS.PLAN_CREATED, {
    taskId: state.taskId, runId: state.runId, planId: plan.id,
    steps: planSteps as unknown as Record<string, unknown>[],
  });

  // ─── HITL: plan_first approval ─────────────────────────────────────────
  if (state.approvalMode === 'plan_first') {
    const stepSummaries = planSteps.map(s => ({
      stepIndex: s.stepIndex, description: s.description,
      executor: s.subAgent ? `subagent:${s.subAgent}` : (s.skillName ?? s.toolHint ?? 'think'),
    }));
    const decision = interrupt({
      type: 'plan_review', planId: plan.id, stepCount: planSteps.length, steps: stepSummaries,
    });
    await ctx.callbacks.setRunStatus(state.runId, RunStatus.RUNNING);
    if (decision === 'rejected') {
      return new Command({ update: { error: 'plan_rejected' }, goto: END });
    }
  }

  const planDef: PlanDef = { planId: plan.id, steps: planSteps };

  return new Command({
    update: {
      intent: resolvedIntent,
      plan: planDef,
      stepIndex: 0,
      retryCount: 0,
      lastStepRunId: '',
      lastOutput: '',
    },
    goto: 'executor',
  });
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function buildPromptArgs(state: AgentState, ctx: NodeContext) {
  const skillSection = ctx.skillRegistry.getPlannerPromptSection();
  const toolSection = '可用工具：\n' + ctx.toolRegistry.getAvailableForPlanner()
    .map(t => `- ${t.name} [${t.type}]: ${t.description}`).join('\n');

  const completedContext = state.stepResults.length > 0
    ? '\n\n已完成步骤摘要：\n' + state.stepResults.map(s => `- ${s.description}: ${s.resultSummary}`).join('\n')
    : '';

  const usedTokens = ctx.tokenTracker.totalTokens;
  const budget = 100_000; // rough default
  const remaining = budget - usedTokens;
  const budgetHint = usedTokens > 0 && remaining < budget * 0.4
    ? `\n⚠️ Token 预算紧张（已用 ${Math.round(usedTokens / 1000)}K），请将步骤控制在 3 步以内。`
    : '';

  return { skillSection, toolSection, completedContext, budgetHint };
}

async function getMemoryContext(state: AgentState, ctx: NodeContext, config: RunnableConfig): Promise<string> {
  const store = getStore(config);
  if (store) {
    try {
      const memories = await store.search(['task_memory', state.taskId], { limit: 5 });
      if (memories.length > 0) {
        return '\n\n[历史执行记忆]\n' + memories.map(m => (m.value as { summary: string }).summary).join('\n');
      }
    } catch { /* ignore */ }
  }
  try {
    const memory = await ctx.callbacks.getRecentMemory(state.taskId);
    if (memory) return '\n\n[历史执行记忆]\n' + memory;
  } catch { /* ignore */ }
  return '';
}

/** Combined intent classification + step planning in one LLM call (first run) */
async function classifyAndPlan(
  state: AgentState, ctx: NodeContext, config: RunnableConfig,
): Promise<{ intent: TaskIntent; steps: PlanStepDef[] } | { error: string }> {
  const { skillSection, toolSection, completedContext, budgetHint } = buildPromptArgs(state, ctx);
  const memoryContext = await getMemoryContext(state, ctx, config);

  const llmChain = combinedPlannerPrompt.pipe(
    ctx.llm.withStructuredOutput(CombinedPlannerSchema, { method: ctx.soMethod }),
  );
  const chain = buildGuardedPlannerChain(llmChain);

  const baseArgs = {
    revisionInput: state.userInput, taskId: state.taskId,
    completedContext, skillSection, toolSection, memoryContext,
    intentGuidance: '', budgetHint, validationErrors: '',
  };

  let result: z.infer<typeof CombinedPlannerSchema>;
  try {
    result = await chain.invoke(baseArgs) as z.infer<typeof CombinedPlannerSchema>;
  } catch (err) {
    if (err instanceof GuardrailBlockedError) return { error: `guardrail_blocked:${err.reason}` };
    throw err;
  }

  // Validate intent
  if (!VALID_INTENTS.includes(result.intent as TaskIntent)) {
    logger.warn(`未知意图 "${result.intent}"，fallback 到 general`);
    result = { ...result, intent: 'general' };
  }

  ctx.eventPublisher.emit(TASK_EVENTS.PLAN_GENERATING, {
    taskId: state.taskId, runId: state.runId, isReplan: false, intent: result.intent,
  });

  // Skip semantic validation for deterministic intents (their steps come from workflowBuilder)
  const intentConfig = getIntentConfig(result.intent as TaskIntent);
  if (intentConfig.workflowBuilder) {
    return { intent: result.intent as TaskIntent, steps: result.steps };
  }

  // Semantic validation with retry
  const errors1 = validatePlanSemantics(result.steps, ctx.skillRegistry, ctx.toolRegistry, ctx.planValidationOptions);
  if (errors1.length === 0) {
    return { intent: result.intent as TaskIntent, steps: result.steps };
  }

  logger.warn(`Plan validation failed (attempt 1): ${errors1.map(e => e.message).join(' | ')}`);
  const intentGuidance = intentConfig.plannerGuidance ?? '';
  try {
    result = await chain.invoke({ ...baseArgs, intentGuidance, validationErrors: formatValidationErrors(errors1) }) as z.infer<typeof CombinedPlannerSchema>;
  } catch (err) {
    if (err instanceof GuardrailBlockedError) return { error: `guardrail_blocked:${err.reason}` };
    throw err;
  }

  const errors2 = validatePlanSemantics(result.steps, ctx.skillRegistry, ctx.toolRegistry, ctx.planValidationOptions);
  if (errors2.length > 0) {
    return { error: `Planner 语义校验连续失败（${errors2.slice(0, 2).map(e => e.message).join('；')}）` };
  }

  return { intent: result.intent as TaskIntent, steps: result.steps };
}

/** Replan: intent already known, use plannerPrompt (without classification) */
async function replan(state: AgentState, ctx: NodeContext, config: RunnableConfig): Promise<PlanStepDef[]> {
  const { skillSection, toolSection, completedContext, budgetHint } = buildPromptArgs(state, ctx);
  const memoryContext = await getMemoryContext(state, ctx, config);
  const intentGuidance = getIntentConfig(state.intent).plannerGuidance ?? INTENT_GUIDANCE[state.intent] ?? '';

  const llmChain = plannerPrompt.pipe(
    ctx.llm.withStructuredOutput(ReplanSchema, { method: ctx.soMethod }),
  );
  const chain = buildGuardedPlannerChain(llmChain);

  const baseArgs = {
    revisionInput: state.userInput, taskId: state.taskId,
    completedContext, skillSection, toolSection, memoryContext,
    intentGuidance, budgetHint, validationErrors: '',
  };

  let result: z.infer<typeof ReplanSchema>;
  try {
    result = await chain.invoke(baseArgs) as z.infer<typeof ReplanSchema>;
  } catch (err) {
    if (err instanceof GuardrailBlockedError) throw new Error(`guardrail_blocked:${err.reason}`);
    throw err;
  }

  const errors = validatePlanSemantics(result.steps, ctx.skillRegistry, ctx.toolRegistry, ctx.planValidationOptions);
  if (errors.length > 0) {
    // One retry for replan
    try {
      result = await chain.invoke({ ...baseArgs, validationErrors: formatValidationErrors(errors) }) as z.infer<typeof ReplanSchema>;
    } catch (err) {
      if (err instanceof GuardrailBlockedError) throw new Error(`guardrail_blocked:${err.reason}`);
      throw err;
    }
    const errors2 = validatePlanSemantics(result.steps, ctx.skillRegistry, ctx.toolRegistry, ctx.planValidationOptions);
    if (errors2.length > 0) {
      throw new Error(`Replan 语义校验失败（${errors2.slice(0, 2).map(e => e.message).join('；')}）`);
    }
  }

  return result.steps;
}
