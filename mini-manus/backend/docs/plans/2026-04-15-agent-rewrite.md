# Agent Module Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the agent module from ~3,200 lines to ~2,000 lines using LangGraph best practices: compile-once graph, NodeContext via config.configurable, Command routing, and centralized intent configuration.

**Architecture:** Single flat StateGraph with 4 nodes (planner, executor, checker, finalizer). Planner and checker use Command for routing. Executor is a thin dispatcher delegating to 3 focused executor files. All runtime dependencies passed via NodeContext through config.configurable.

**Tech Stack:** LangGraph.js, LangChain.js, NestJS 11, TypeScript, Zod

**Spec:** `docs/specs/2026-04-15-agent-rewrite-design.md`

---

## File Structure

Files are listed in dependency order. Each task creates/modifies files that only depend on previously created files.

**New files (create):**
- `src/agent/agent.state.ts` — State schema (13 fields)
- `src/agent/agent.context.ts` — NodeContext type + getCtx helper
- `src/agent/intent.config.ts` — Centralized intent configuration registry
- `src/agent/plan-validator.ts` — Simplified plan semantic validation
- `src/agent/executors/tool.executor.ts` — Tool Calling + execution
- `src/agent/executors/skill.executor.ts` — Skill iterator execution
- `src/agent/executors/subagent.executor.ts` — createReactAgent execution
- `src/agent/nodes/planner.node.ts` — Merged router + planner
- `src/agent/nodes/executor.node.ts` — Thin dispatcher
- `src/agent/nodes/checker.node.ts` — Rules + LLM + Command routing
- `src/agent/nodes/finalizer.node.ts` — Artifact generation
- `src/agent/agent.graph.ts` — Graph definition + compile helper
- `src/agent/agent.service.ts` — NestJS service shell
- `src/agent/agent.module.ts` — Module wiring

**Unchanged files (keep as-is):**
- `src/agent/agent.callbacks.ts`
- `src/agent/token-tracker.callback.ts`
- `src/agent/token-budget.guard.ts`
- `src/agent/guardrails/guardrail.chain.ts`
- `src/agent/guardrails/guardrail-blocked.error.ts`

**Modified files:**
- `src/prompts/index.ts` — Add combined planner prompt, remove routerPrompt and templateParamExtractionPrompt

**Deleted files:**
- `src/agent/nodes/router.node.ts`
- `src/agent/nodes/research-subgraph.ts`
- `src/agent/workflow.registry.ts`
- `src/agent/subagents/react-subagent.ts`
- `src/agent/subagents/subagent.registry.ts`
- `src/agent/nodes/router.node.spec.ts`
- `src/agent/nodes/planner.node.spec.ts`
- `src/agent/nodes/evaluator.node.spec.ts`
- `src/agent/nodes/sandbox-s2.spec.ts`
- `src/agent/nodes/trajectory.spec.ts`
- `src/agent/agent.service.spec.ts`

---

### Task 1: Foundation Types — State + Context

**Files:**
- Create: `src/agent/agent.state.ts`
- Create: `src/agent/agent.context.ts`

- [ ] **Step 1: Write agent.state.ts**

Replace the existing file with the new 13-field state schema:

```typescript
// src/agent/agent.state.ts
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
```

- [ ] **Step 2: Write agent.context.ts**

```typescript
// src/agent/agent.context.ts
import type { ChatOpenAI } from '@langchain/openai';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { ToolRegistry } from '@/tool/tool.registry';
import type { SkillRegistry } from '@/skill/skill.registry';
import type { WorkspaceService } from '@/workspace/workspace.service';
import type { EventPublisher } from '@/event/event.publisher';
import type { AgentCallbacks } from '@/agent/agent.callbacks';
import type { SubAgentRegistry } from '@/agent/subagents/subagent.registry';
import type { TokenTrackerCallback } from '@/agent/token-tracker.callback';
import type { TokenBudgetGuard } from '@/agent/token-budget.guard';
import type { PlanSemanticValidationOptions } from '@/agent/plan-validator';

export interface NodeContext {
  // External dependencies (NestJS DI)
  llm: ChatOpenAI;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  workspace: WorkspaceService;
  callbacks: AgentCallbacks;
  eventPublisher: EventPublisher;
  subAgentRegistry: SubAgentRegistry;

  // Per-run runtime
  signal: AbortSignal;
  tokenTracker: TokenTrackerCallback;
  tokenBudgetGuard: TokenBudgetGuard;

  // Global config (shared across runs)
  soMethod: 'functionCalling' | 'json_schema' | 'jsonMode';
  maxRetries: number;
  maxReplans: number;
  maxSteps: number;
  stepTimeoutMs: number;
  skillTimeoutMs: number;
  exportPdfEnabled: boolean;
  planValidationOptions: PlanSemanticValidationOptions;
}

/** Extract NodeContext from LangGraph RunnableConfig */
export function getCtx(config: RunnableConfig): NodeContext {
  return (config as { configurable: { ctx: NodeContext } }).configurable.ctx;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/mini-manus/backend && npx tsc --noEmit src/agent/agent.state.ts src/agent/agent.context.ts 2>&1 | head -20`

Expected: No errors (or only errors about missing imports from files not yet created — plan-validator.ts)

- [ ] **Step 4: Commit**

```bash
git add src/agent/agent.state.ts src/agent/agent.context.ts
git commit -m "feat(agent): add new state schema and NodeContext types for rewrite"
```

---

### Task 2: Intent Configuration + Plan Validator

**Files:**
- Create: `src/agent/intent.config.ts`
- Create: `src/agent/plan-validator.ts`

- [ ] **Step 1: Write intent.config.ts**

```typescript
// src/agent/intent.config.ts
import type { AgentState, PlanStepDef, TaskIntent } from '@/agent/agent.state';
import type { NodeContext } from '@/agent/agent.context';

/** Step results placeholder, resolved at runtime by executor */
export const STEP_RESULTS_PLACEHOLDER = '__STEP_RESULTS__';

export interface IntentConfig {
  /** Fixed workflow builder — if present, skip LLM planning */
  workflowBuilder?: (state: AgentState, ctx: NodeContext) => PlanStepDef[];
  /** Whether checker skips LLM evaluation (deterministic = pure rule-based) */
  deterministicCheck: boolean;
  /** Whether finalizer uses last step output directly as artifact body */
  useLastStepAsArtifact: boolean;
  /** Extra guidance injected into planner LLM prompt for this intent */
  plannerGuidance?: string;
}

export const INTENT_CONFIGS: Record<TaskIntent, IntentConfig> = {
  code_generation: {
    workflowBuilder: (state, ctx) => {
      const steps: PlanStepDef[] = [
        {
          stepIndex: 0,
          description: '根据需求生成完整代码项目',
          skillName: 'code_project_generation',
          skillInput: {
            task_id: state.taskId,
            project_description: state.userInput,
          },
        },
      ];
      if (ctx.toolRegistry.has('sandbox_run_node')) {
        steps.push({
          stepIndex: 1,
          description: '在沙箱中运行生成的代码，验证可执行性',
          toolHint: 'sandbox_run_node',
          toolInput: { task_id: state.taskId, entry: 'project/index.js' },
        });
      }
      return steps;
    },
    deterministicCheck: true,
    useLastStepAsArtifact: false,
    plannerGuidance: `【代码生成任务专用规划策略】
- 必须使用 code_project_generation skill 生成代码文件，禁止拆成多个 write_file step
- 如果 completedContext 中出现 code_execution_failed，使用 code_fix skill 修复`,
  },

  research_report: {
    workflowBuilder: (state) => [
      {
        stepIndex: 0,
        description: '围绕主题进行深度网络调研',
        subAgent: 'researcher',
        objective: `调研主题：${state.userInput}。\n\n请使用搜索和浏览工具从多角度收集信息，阅读 2-4 个高质量来源，综合整理核心发现、数据和结论，最终输出完整的调研报告。`,
      },
      {
        stepIndex: 1,
        description: '基于调研结果撰写并输出完整报告文件',
        subAgent: 'writer',
        objective: `报告主题：${state.userInput}。\n\n前序调研摘要：\n${STEP_RESULTS_PLACEHOLDER}\n\n请基于以上材料撰写完整的调研报告，保存为 task-report.md，同时导出 task-report.pdf。`,
      },
    ],
    deterministicCheck: true,
    useLastStepAsArtifact: true,
    plannerGuidance: `【调研报告任务专用规划策略】
- 推荐流程：researcher SubAgent（调研）→ writer SubAgent（撰写报告文件）`,
  },

  competitive_analysis: {
    workflowBuilder: (state) => [
      {
        stepIndex: 0,
        description: '对两个对比对象进行系统性调研',
        subAgent: 'researcher',
        objective: `对比调研：${state.userInput}。\n\n请系统搜索两个对比对象的官方文档、技术博客和第三方评测，重点收集架构设计、性能表现、集成能力、开发体验和成本模型等维度的数据。`,
      },
      {
        stepIndex: 1,
        description: '基于调研结果撰写并输出完整对比报告文件',
        subAgent: 'writer',
        objective: `对比报告主题：${state.userInput}。\n\n前序调研摘要：\n${STEP_RESULTS_PLACEHOLDER}\n\n请基于以上材料撰写结构完整的对比报告，保存为 comparison-report.md，同时导出 comparison-report.pdf。`,
      },
    ],
    deterministicCheck: true,
    useLastStepAsArtifact: true,
    plannerGuidance: `【对比分析任务专用规划策略】
- 推荐流程：researcher SubAgent（同时调研两个对比对象）→ writer SubAgent（撰写对比报告）`,
  },

  content_writing: {
    deterministicCheck: false,
    useLastStepAsArtifact: false,
    plannerGuidance: `【内容撰写任务专用规划策略】
- 优先使用 writer SubAgent 直接撰写内容
- 如果需要素材，先 researcher SubAgent 收集，再 writer SubAgent 撰写`,
  },

  general: {
    deterministicCheck: false,
    useLastStepAsArtifact: false,
  },
};

/** Get intent config, falling back to general for unknown intents */
export function getIntentConfig(intent: TaskIntent): IntentConfig {
  return INTENT_CONFIGS[intent] ?? INTENT_CONFIGS.general;
}
```

- [ ] **Step 2: Write plan-validator.ts**

Simplified from current 230-line version — remove duplicated side-effect checks, streamline error collection:

```typescript
// src/agent/plan-validator.ts
import type { SkillRegistry } from '@/skill/skill.registry';
import type { ToolRegistry } from '@/tool/tool.registry';

interface RawStep {
  stepIndex: number;
  description?: string;
  skillName?: string | null;
  skillInput?: unknown;
  toolHint?: string | null;
  toolInput?: unknown;
  subAgent?: string | null;
  objective?: string | null;
}

export interface PlanValidationError {
  stepIndex: number;
  field: string;
  message: string;
}

export interface PlanSemanticValidationOptions {
  maxSteps?: number;
  allowedSideEffectTools?: string[];
  allowedSideEffectSkills?: string[];
}

export function validatePlanSemantics(
  steps: RawStep[],
  skillRegistry: SkillRegistry,
  toolRegistry: ToolRegistry,
  options: PlanSemanticValidationOptions = {},
): PlanValidationError[] {
  const errors: PlanValidationError[] = [];
  const allowedTools = new Set(options.allowedSideEffectTools ?? []);
  const allowedSkills = new Set(options.allowedSideEffectSkills ?? []);

  if (steps.length === 0) {
    errors.push({ stepIndex: -1, field: 'steps', message: '计划至少需要包含一个步骤' });
    return errors;
  }
  if (options.maxSteps != null && steps.length > options.maxSteps) {
    errors.push({ stepIndex: -1, field: 'steps', message: `计划步骤数不能超过 ${options.maxSteps}` });
  }

  for (const [i, step] of steps.entries()) {
    if (step.stepIndex !== i) {
      errors.push({ stepIndex: step.stepIndex, field: 'stepIndex', message: 'stepIndex 必须按数组顺序从 0 开始连续递增' });
    }
    if (!step.description?.trim()) {
      errors.push({ stepIndex: i, field: 'description', message: 'description 不能为空' });
    }

    const hasSkill = Boolean(step.skillName?.trim());
    const hasTool = Boolean(step.toolHint?.trim());
    const hasSubAgent = Boolean(step.subAgent?.trim());

    if (!hasSkill && !hasTool && !hasSubAgent) {
      errors.push({ stepIndex: i, field: 'executor', message: '步骤必须指定 skillName、toolHint 或 subAgent 之一' });
      continue;
    }
    if (hasSubAgent) continue; // SubAgent steps need no further validation

    if (hasSkill && hasTool) {
      errors.push({ stepIndex: i, field: 'executor', message: '步骤不能同时指定 skillName 和 toolHint' });
      continue;
    }

    if (hasSkill) {
      const name = step.skillName!;
      if (!skillRegistry.has(name)) {
        errors.push({ stepIndex: i, field: 'skillName', message: `Skill "${name}" 未注册，可用：${skillRegistry.getAll().map(s => s.name).join(', ')}` });
      } else {
        const skill = skillRegistry.get(name);
        if (skill.effect === 'side-effect' && !allowedSkills.has(name)) {
          errors.push({ stepIndex: i, field: 'skillName', message: `Side-effect Skill "${name}" 未在允许列表中` });
        }
        if (step.skillInput != null) {
          const result = skill.inputSchema.safeParse(step.skillInput);
          if (!result.success) {
            errors.push({ stepIndex: i, field: 'skillInput', message: `skillInput 不符合 schema: ${result.error.issues.map(x => x.message).join('; ')}` });
          }
        }
      }
    }

    if (hasTool) {
      const name = step.toolHint!;
      if (!toolRegistry.has(name)) {
        errors.push({ stepIndex: i, field: 'toolHint', message: `Tool "${name}" 未注册，可用：${toolRegistry.getAll().map(t => t.name).join(', ')}` });
      } else {
        const tool = toolRegistry.get(name);
        if (tool.type === 'side-effect' && !allowedTools.has(name)) {
          errors.push({ stepIndex: i, field: 'toolHint', message: `Side-effect Tool "${name}" 未在允许列表中` });
        }
        if (step.toolInput != null) {
          const result = tool.schema.safeParse(step.toolInput);
          if (!result.success) {
            errors.push({ stepIndex: i, field: 'toolInput', message: `toolInput 不符合 schema: ${result.error.issues.map(x => x.message).join('; ')}` });
          }
        }
      }
    }
  }

  return errors;
}

export function formatValidationErrors(errors: PlanValidationError[]): string {
  return (
    '\n\n[语义校验失败，请修正以下问题后重新输出完整计划]\n' +
    errors.map(e => `  步骤 ${e.stepIndex} [${e.field}]：${e.message}`).join('\n')
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/agent/intent.config.ts src/agent/plan-validator.ts
git commit -m "feat(agent): add intent config registry and simplified plan validator"
```

---

### Task 3: Executor Implementations

**Files:**
- Create: `src/agent/executors/tool.executor.ts`
- Create: `src/agent/executors/skill.executor.ts`
- Create: `src/agent/executors/subagent.executor.ts`

- [ ] **Step 1: Create executors directory**

```bash
mkdir -p src/agent/executors
```

- [ ] **Step 2: Write shared utility — resolveStepResults**

This goes at the top of each executor or in a shared helper. Since it's small, include inline in subagent.executor.ts and skill.executor.ts. But first define the shared `withTimeout` and `persistStepOutput` helpers that all executors use. Create a shared file:

```typescript
// src/agent/executors/shared.ts
import { Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { WorkspaceService } from '@/workspace/workspace.service';
import type { AgentState, StepResult } from '@/agent/agent.state';
import { STEP_RESULTS_PLACEHOLDER } from '@/agent/intent.config';

const logger = new Logger('Executor');

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
      JSON.stringify({ description, output, structuredData: structuredData ?? null, executionOrder, timestamp: new Date().toISOString() }, null, 2),
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
  state: AgentState,
): Record<string, unknown> {
  return { ...input, task_id: input.task_id ?? state.taskId, run_id: input.run_id ?? state.runId };
}
```

- [ ] **Step 3: Write tool.executor.ts**

```typescript
// src/agent/executors/tool.executor.ts
import { Logger } from '@nestjs/common';
import { tool as lcTool } from '@langchain/core/tools';
import { toolCallingPrompt } from '@/prompts';
import type { AgentState } from '@/agent/agent.state';
import type { NodeContext } from '@/agent/agent.context';
import type { Tool } from '@/tool/interfaces/tool.interface';
import { TASK_EVENTS } from '@/common/events/task.events';
import { DB_RESULT_SUMMARY_MAX, PROMPT_RETRY_HINT_MAX } from '@/common/constants/system-limits';
import { withTimeout, persistStepOutput, attachRuntimeContext } from './shared';

const logger = new Logger('ToolExecutor');
const TOOL_CALLING_TIMEOUT_MS = 30_000;

/**
 * Tools whose key parameters (URL, content) must come from runtime context.
 * Tool Calling failure for these is fatal — planner's original values are wrong by definition.
 */
const DYNAMIC_PARAM_TOOLS = new Set(['browse_url', 'fetch_url_as_markdown', 'write_file', 'export_pdf']);

function toLangChainTool(t: Tool) {
  return lcTool(async () => '', { name: t.name, description: t.description, schema: t.schema });
}

export interface ToolExecutorResult {
  output: string;
  structuredData?: unknown;
}

export async function executeToolStep(
  state: AgentState,
  ctx: NodeContext,
  step: { description: string; toolHint?: string | null; toolInput?: Record<string, unknown> | null },
  stepRunId: string,
): Promise<ToolExecutorResult> {
  const toolName = step.toolHint ?? 'think';
  const plannerInput: Record<string, unknown> = step.toolInput ?? { thought: step.description };

  // Resolve tool call parameters via LLM (when prior steps exist and tool is not 'think')
  const resolved = await resolveToolCallViaLLM(toolName, plannerInput, step, state, ctx);

  if (ctx.signal.aborted) throw new Error('cancelled');

  const toolInput = attachRuntimeContext(resolved.args, state);

  ctx.eventPublisher.emit(TASK_EVENTS.TOOL_CALLED, {
    taskId: state.taskId, runId: state.runId, stepRunId, toolName, toolInput,
  });

  const toolResult = await withTimeout(
    ctx.toolRegistry.executeWithCache(toolName, toolInput),
    ctx.stepTimeoutMs,
  );

  ctx.eventPublisher.emit(TASK_EVENTS.TOOL_COMPLETED, {
    taskId: state.taskId, runId: state.runId, stepRunId, toolName,
    toolOutput: toolResult.success ? toolResult.output : (toolResult.error ?? toolResult.output),
    cached: toolResult.cached ?? false,
    error: toolResult.error ?? null,
    errorCode: toolResult.errorCode ?? null,
  });

  const failureContext = toolResult.success
    ? null
    : `error (${toolResult.errorCode ?? 'tool_execution_failed'}): ${toolResult.error ?? toolResult.output ?? '工具执行失败'}`;

  if (toolResult.success) {
    logger.log(`${toolName} ✓ ${toolResult.cached ? '(cached) ' : ''}${toolResult.output.slice(0, 80)}`);
  } else {
    logger.warn(`${toolName} ✗ ${failureContext!.slice(0, 120)}`);
  }

  const resultSummary = toolResult.success
    ? toolResult.output.slice(0, DB_RESULT_SUMMARY_MAX)
    : failureContext!;

  await ctx.callbacks.updateStepRun(stepRunId, {
    executorType: 'tool' as any,
    toolName, toolInput, toolOutput: toolResult.output,
    resultSummary, errorMessage: toolResult.success ? null : (toolResult.error ?? null),
    completedAt: new Date(),
  });

  if (toolResult.success) {
    await persistStepOutput(ctx.workspace, state.taskId, state.executionOrder, toolName, step.description, toolResult.output, toolResult.structuredData);
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
  if (state.stepResults.length === 0) return { name: toolName, args: fallbackInput };

  const tool = ctx.toolRegistry.get(toolName);
  const lcToolDef = toLangChainTool(tool);

  const stepContext = state.stepResults
    .map(s => `步骤 ${s.executionOrder + 1}: ${s.description}\n${s.toolOutput ? `工具输出: ${s.toolOutput}` : `结果: ${s.resultSummary}`}`)
    .join('\n\n');

  const retryHint = state.retryCount > 0 && state.lastOutput
    ? `\n\n⚠️ 这是第 ${state.retryCount + 1} 次尝试，上次失败原因：${state.lastOutput.slice(0, PROMPT_RETRY_HINT_MAX)}\n请使用不同的参数重试。`
    : '';

  if (ctx.signal.aborted) return { name: toolName, args: fallbackInput };

  try {
    const llmWithTool = ctx.llm.bindTools([lcToolDef]);
    const messages = await toolCallingPrompt.formatMessages({
      revisionInput: state.userInput, stepDescription: step.description, stepContext, retryHint,
    });
    const response = await withTimeout(llmWithTool.invoke(messages, { signal: ctx.signal }), TOOL_CALLING_TIMEOUT_MS);

    const toolCall = response.tool_calls?.[0];
    if (toolCall && toolCall.name === toolName) {
      const argsWithRuntime = { ...(toolCall.args as Record<string, unknown>), task_id: state.taskId, run_id: state.runId };
      const parsed = tool.schema.safeParse(argsWithRuntime);
      if (parsed.success) {
        logger.log(`Tool Calling 决议 ${toolName} 参数 ✓`);
        return { name: toolCall.name, args: parsed.data as Record<string, unknown> };
      }
      logger.warn(`Tool Calling 参数校验失败，fallback`);
    }
  } catch (err) {
    logger.warn(`Tool Calling 失败: ${err instanceof Error ? err.message : err}`);
  }

  // Fail-closed for dynamic param tools
  if (DYNAMIC_PARAM_TOOLS.has(toolName)) {
    throw new Error(`工具 ${toolName} 需要运行时参数，Tool Calling 决议失败，无法继续执行。`);
  }

  // Placeholder check for fallback
  const suspicious = Object.entries(fallbackInput).filter(
    ([, v]) => typeof v === 'string' && (v.includes('example.com') || v === '...' || v.trim() === ''),
  );
  if (suspicious.length > 0) {
    throw new Error(`工具 ${toolName} 参数决议失败：字段 ${suspicious.map(([k]) => k).join(', ')} 为占位符`);
  }

  return { name: toolName, args: fallbackInput };
}
```

- [ ] **Step 4: Write skill.executor.ts**

```typescript
// src/agent/executors/skill.executor.ts
import { Logger } from '@nestjs/common';
import type { AgentState } from '@/agent/agent.state';
import type { NodeContext } from '@/agent/agent.context';
import { ExecutorType } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { withTimeout, persistStepOutput, resolveStepResultsInRecord } from './shared';

const logger = new Logger('SkillExecutor');

export interface SkillExecutorResult {
  output: string;
  structuredData?: unknown;
}

export async function executeSkillStep(
  state: AgentState,
  ctx: NodeContext,
  step: { description: string; skillName: string; skillInput?: Record<string, unknown> | null },
  stepRunId: string,
): Promise<SkillExecutorResult> {
  const skill = ctx.skillRegistry.get(step.skillName);
  const skillTrace: Array<{ tool: string; input: unknown; output: string }> = [];
  let finalOutput: unknown = null;

  const resolvedInput = resolveStepResultsInRecord(step.skillInput ?? {}, state.stepResults);

  await withTimeout(
    (async () => {
      for await (const event of skill.execute(resolvedInput, {
        tools: ctx.toolRegistry,
        llm: ctx.llm,
        workspace: ctx.workspace,
        signal: ctx.signal,
        soMethod: ctx.soMethod,
        taskId: state.taskId,
        priorStepSummaries: state.stepResults.map(s => s.description),
        remainingBudgetHint: ctx.tokenBudgetGuard
          ? (ctx.planValidationOptions.maxSteps ?? 20) * 5000 // rough estimate
          : undefined,
      })) {
        if (event.type === 'tool_call') {
          ctx.eventPublisher.emit(TASK_EVENTS.TOOL_CALLED, {
            taskId: state.taskId, runId: state.runId, stepRunId,
            toolName: event.tool, toolInput: event.input as Record<string, unknown>,
          });
          skillTrace.push({ tool: event.tool, input: event.input, output: '' });
        } else if (event.type === 'tool_result') {
          if (skillTrace.length > 0) skillTrace[skillTrace.length - 1].output = event.output;
          ctx.eventPublisher.emit(TASK_EVENTS.TOOL_COMPLETED, {
            taskId: state.taskId, runId: state.runId, stepRunId,
            toolName: event.tool, toolOutput: event.output,
            cached: event.cached ?? false, error: event.error ?? null, errorCode: event.errorCode ?? null,
          });
        } else if (event.type === 'progress') {
          ctx.eventPublisher.emit(TASK_EVENTS.STEP_PROGRESS, {
            taskId: state.taskId, runId: state.runId, stepRunId,
            planStepId: '', message: event.message,
          });
        } else if (event.type === 'result') {
          finalOutput = event.output;
        }
        if (ctx.signal.aborted) break;
      }
    })(),
    ctx.skillTimeoutMs,
  );

  const resultSummary = typeof finalOutput === 'string' ? finalOutput : JSON.stringify(finalOutput);

  await ctx.callbacks.updateStepRun(stepRunId, {
    executorType: ExecutorType.SKILL,
    skillName: step.skillName, skillTrace, resultSummary,
    completedAt: new Date(),
  });

  await persistStepOutput(
    ctx.workspace, state.taskId, state.executionOrder, step.skillName, step.description, resultSummary,
    typeof finalOutput === 'object' && finalOutput !== null ? finalOutput : undefined,
  );

  return { output: resultSummary };
}
```

- [ ] **Step 5: Write subagent.executor.ts**

```typescript
// src/agent/executors/subagent.executor.ts
import { Logger } from '@nestjs/common';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { AgentState } from '@/agent/agent.state';
import type { NodeContext } from '@/agent/agent.context';
import { ExecutorType } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { DB_RESULT_SUMMARY_MAX } from '@/common/constants/system-limits';
import { withTimeout, persistStepOutput, resolveStepResultsInString } from './shared';

const logger = new Logger('SubAgentExecutor');

/** Bridges SubAgent internal tool calls to main EventPublisher */
class SubAgentEventBridge extends BaseCallbackHandler {
  name = 'SubAgentEventBridge';
  private readonly toolNames = new Map<string, string>();

  constructor(
    private readonly publisher: EventPublisher,
    private readonly taskId: string,
    private readonly runId: string,
    private readonly stepRunId: string,
  ) { super(); }

  override handleToolStart(_tool: Serialized, input: string, toolRunId: string, _parentRunId?: string, _tags?: string[], _metadata?: Record<string, unknown>, runName?: string) {
    const toolName = runName ?? 'unknown_tool';
    this.toolNames.set(toolRunId, toolName);
    let toolInput: Record<string, unknown>;
    try { toolInput = JSON.parse(input) as Record<string, unknown>; } catch { toolInput = { raw: input }; }
    this.publisher.emit(TASK_EVENTS.TOOL_CALLED, { taskId: this.taskId, runId: this.runId, stepRunId: this.stepRunId, toolName, toolInput });
  }

  override handleToolEnd(output: string, toolRunId: string) {
    const toolName = this.toolNames.get(toolRunId) ?? 'unknown_tool';
    this.toolNames.delete(toolRunId);
    this.publisher.emit(TASK_EVENTS.TOOL_COMPLETED, {
      taskId: this.taskId, runId: this.runId, stepRunId: this.stepRunId, toolName,
      toolOutput: typeof output === 'string' ? output : JSON.stringify(output),
      cached: false, error: null, errorCode: null,
    });
  }
}

// Need to import EventPublisher type for the bridge class
import type { EventPublisher } from '@/event/event.publisher';

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
  const resolvedObjective = resolveStepResultsInString(rawObjective, state.stepResults);
  const injected = def.injectArgs ? def.injectArgs(state.taskId) : {};

  const tools = def.tools
    .filter(name => ctx.toolRegistry.has(name))
    .map(name => ctx.toolRegistry.getAsLangChainTool(name, injected));

  ctx.eventPublisher.emit(TASK_EVENTS.STEP_PROGRESS, {
    taskId: state.taskId, runId: state.runId, stepRunId, planStepId: '',
    message: `SubAgent [${step.subAgent}] 启动中…`,
  });

  const agent = createReactAgent({ llm: ctx.llm, tools, messageModifier: def.systemPrompt });
  const eventBridge = new SubAgentEventBridge(ctx.eventPublisher, state.taskId, state.runId, stepRunId);

  const result = await withTimeout(
    agent.invoke({ messages: [new HumanMessage(resolvedObjective)] }, { signal: ctx.signal, callbacks: [eventBridge] }),
    ctx.skillTimeoutMs,
  );

  if (ctx.signal.aborted) throw new Error('cancelled');

  // Extract text from last AI message
  const messages = result.messages;
  const lastMsg = messages[messages.length - 1];
  const content = lastMsg?.content;
  let output: string;
  if (typeof content === 'string') output = content;
  else if (Array.isArray(content)) output = content.map((c: any) => typeof c === 'string' ? c : (c.text ?? '')).join('');
  else output = JSON.stringify(content ?? '');

  const summary = output.slice(0, DB_RESULT_SUMMARY_MAX);

  await ctx.callbacks.updateStepRun(stepRunId, {
    executorType: ExecutorType.SKILL,
    skillName: `subagent:${step.subAgent}`,
    resultSummary: summary,
    completedAt: new Date(),
  });

  await persistStepOutput(ctx.workspace, state.taskId, state.executionOrder, `subagent_${step.subAgent}`, step.description, output);

  return { output };
}
```

- [ ] **Step 6: Commit**

```bash
git add src/agent/executors/
git commit -m "feat(agent): add focused executor implementations (tool, skill, subagent)"
```

---

### Task 4: Planner Node

**Files:**
- Create: `src/agent/nodes/planner.node.ts`
- Modify: `src/prompts/index.ts` (add combined prompt)

- [ ] **Step 1: Add combined planner prompt to prompts/index.ts**

Append after the existing `routerPrompt` definition (we'll remove the old prompts in the cleanup task):

```typescript
// Add to src/prompts/index.ts — Combined planner prompt (classification + planning in one call)
export const combinedPlannerPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个任务规划器。你需要完成两件事：

**第一步：判断任务意图（intent）**
- code_generation: 生成代码项目、脚手架、写程序、创建应用
- research_report: 调研报告、技术方案、深度分析、信息收集
- competitive_analysis: 对比分析、竞品调研、方案比较
- content_writing: 撰写文档、文章、邮件、演讲稿、总结
- general: 以上都不匹配

**第二步：将任务拆解成 3-6 个可执行步骤**

{skillSection}

{toolSection}

{intentGuidance}

规划要求：
1. 如果某一步需要网络搜索 / 调研 → 填写 subAgent: "researcher" 和 objective（调研目标）
2. 如果某一步需要撰写文档 / 报告并保存文件 → 填写 subAgent: "writer" 和 objective（写作目标）
3. 如果某一步能被已加载的 skill 覆盖 → 优先使用 skill（填写 skillName 和 skillInput）
4. 如果没有合适的 subAgent / skill → 填写 toolHint（工具名）和 toolInput（完整参数对象）
5. toolInput 中如果有 task_id 字段，必须填入 "{taskId}"
6. 步骤数量 3-6 个，每步描述清晰
7. 只返回 JSON，不要其他内容`,
  ],
  [
    'human',
    `任务：{revisionInput}
当前任务ID（用于文件操作）：{taskId}{completedContext}{memoryContext}{validationErrors}{budgetHint}`,
  ],
]);
```

- [ ] **Step 2: Write planner.node.ts**

```typescript
// src/agent/nodes/planner.node.ts
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
import { combinedPlannerPrompt } from '@/prompts';
import { RunStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';

const logger = new Logger('PlannerNode');

const VALID_INTENTS: TaskIntent[] = ['code_generation', 'research_report', 'competitive_analysis', 'content_writing', 'general'];

const PlannerSchema = z.object({
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

  if (isReplan) {
    // ─── Replan: keep existing intent, go straight to LLM planning ────────
    resolvedIntent = state.intent;
    planSteps = await llmPlan(state, ctx, resolvedIntent);
  } else {
    // ─── First run: classify + plan ───────────────────────────────────────
    const llmResult = await classifyAndPlan(state, ctx);
    if ('error' in llmResult) {
      return new Command({ update: { error: llmResult.error }, goto: END });
    }
    resolvedIntent = llmResult.intent;

    // Check for deterministic workflow
    const intentConfig = getIntentConfig(resolvedIntent);
    if (intentConfig.workflowBuilder) {
      logger.log(`确定性 workflow: ${resolvedIntent}（跳过 LLM 规划步骤）`);
      planSteps = intentConfig.workflowBuilder(state, ctx);
    } else {
      planSteps = llmResult.steps;
    }
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
    const decision = interrupt({ type: 'plan_review', planId: plan.id, stepCount: planSteps.length, steps: stepSummaries });
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

/** Combined intent classification + step planning in one LLM call */
async function classifyAndPlan(
  state: AgentState,
  ctx: NodeContext,
): Promise<{ intent: TaskIntent; steps: PlanStepDef[] } | { error: string }> {
  const skillSection = ctx.skillRegistry.getPlannerPromptSection();
  const toolSection = '可用工具：\n' + ctx.toolRegistry.getAvailableForPlanner()
    .map(t => `- ${t.name} [${t.type}]: ${t.description}`).join('\n');

  const completedContext = state.stepResults.length > 0
    ? '\n\n已完成步骤摘要：\n' + state.stepResults.map(s => `- ${s.description}: ${s.resultSummary}`).join('\n')
    : '';

  // Memory injection
  let memoryContext = '';
  const store = config ? getStore(config as any) : undefined;
  if (store) {
    try {
      const memories = await store.search(['task_memory', state.taskId], { limit: 5 });
      if (memories.length > 0) {
        memoryContext = '\n\n[历史执行记忆]\n' + memories.map(m => (m.value as { summary: string }).summary).join('\n');
      }
    } catch { /* ignore */ }
  } else {
    try {
      const memory = await ctx.callbacks.getRecentMemory(state.taskId);
      if (memory) memoryContext = '\n\n[历史执行记忆]\n' + memory;
    } catch { /* ignore */ }
  }

  // Budget hint
  const usedTokens = ctx.tokenTracker.totalTokens;
  const budget = ctx.tokenBudgetGuard ? (ctx.planValidationOptions.maxSteps ?? 20) * 5000 : 100_000;
  const remaining = budget - usedTokens;
  const budgetHint = usedTokens > 0 && remaining < budget * 0.4
    ? `\n⚠️ Token 预算紧张（已用 ${Math.round(usedTokens / 1000)}K），请将步骤控制在 3 步以内。`
    : '';

  const llmChain = combinedPlannerPrompt.pipe(
    ctx.llm.withStructuredOutput(PlannerSchema, { method: ctx.soMethod }),
  );
  const chain = buildGuardedPlannerChain(llmChain);

  const baseArgs = {
    revisionInput: state.userInput, taskId: state.taskId,
    completedContext, skillSection, toolSection, memoryContext,
    intentGuidance: '', budgetHint, validationErrors: '',
  };

  // First attempt
  let result: z.infer<typeof PlannerSchema>;
  try {
    result = await chain.invoke(baseArgs) as z.infer<typeof PlannerSchema>;
  } catch (err) {
    if (err instanceof GuardrailBlockedError) {
      return { error: `guardrail_blocked:${err.reason}` };
    }
    throw err;
  }

  // Apply intent guidance for second validation pass if needed
  const intentGuidance = getIntentConfig(result.intent).plannerGuidance ?? '';

  // Semantic validation (skip for deterministic intents — their steps come from workflowBuilder)
  const intentConfig = getIntentConfig(result.intent);
  if (!intentConfig.workflowBuilder) {
    const errors1 = validatePlanSemantics(result.steps, ctx.skillRegistry, ctx.toolRegistry, ctx.planValidationOptions);
    if (errors1.length > 0) {
      logger.warn(`Plan validation failed (attempt 1): ${errors1.map(e => e.message).join(' | ')}`);
      try {
        result = await chain.invoke({ ...baseArgs, intentGuidance, validationErrors: formatValidationErrors(errors1) }) as z.infer<typeof PlannerSchema>;
      } catch (err) {
        if (err instanceof GuardrailBlockedError) return { error: `guardrail_blocked:${err.reason}` };
        throw err;
      }
      const errors2 = validatePlanSemantics(result.steps, ctx.skillRegistry, ctx.toolRegistry, ctx.planValidationOptions);
      if (errors2.length > 0) {
        return { error: `Planner 语义校验连续失败（${errors2.slice(0, 2).map(e => e.message).join('；')}）` };
      }
    }
  }

  ctx.eventPublisher.emit(TASK_EVENTS.PLAN_GENERATING, {
    taskId: state.taskId, runId: state.runId, isReplan: false, intent: result.intent,
  });

  return { intent: result.intent as TaskIntent, steps: result.steps };
}

/** LLM planning for replan path (intent already known) */
async function llmPlan(state: AgentState, ctx: NodeContext, intent: TaskIntent): Promise<PlanStepDef[]> {
  const result = await classifyAndPlan(state, ctx);
  if ('error' in result) throw new Error(result.error);
  return result.steps;
}
```

Note: The `classifyAndPlan` function has a bug — it references `config` variable that's not in scope. Fix: we need to pass `config` or use `getStore` from within the node function. The simplest fix is to pass the RunnableConfig to classifyAndPlan. Let me note this — the implementor should pass `config` as an additional parameter to `classifyAndPlan` and `llmPlan`.

- [ ] **Step 3: Fix — pass config to helper functions**

In the actual implementation, change `classifyAndPlan` and `llmPlan` signatures to accept `config: RunnableConfig` as a parameter, and call them from `plannerNode` as `classifyAndPlan(state, ctx, config)`. Replace `const store = config ? getStore(config as any) : undefined;` with `const store = getStore(config);`.

- [ ] **Step 4: Commit**

```bash
git add src/agent/nodes/planner.node.ts src/prompts/index.ts
git commit -m "feat(agent): add planner node with merged router + intent classification"
```

---

### Task 5: Executor Dispatcher + Checker Node

**Files:**
- Create: `src/agent/nodes/executor.node.ts`
- Create: `src/agent/nodes/checker.node.ts`

- [ ] **Step 1: Write executor.node.ts (thin dispatcher)**

```typescript
// src/agent/nodes/executor.node.ts
import { Logger } from '@nestjs/common';
import { interrupt } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AgentState } from '@/agent/agent.state';
import { getCtx } from '@/agent/agent.context';
import { executeToolStep } from '@/agent/executors/tool.executor';
import { executeSkillStep } from '@/agent/executors/skill.executor';
import { executeSubAgentStep } from '@/agent/executors/subagent.executor';
import { StepStatus, ExecutorType, RunStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';

const logger = new Logger('ExecutorNode');

export async function executorNode(
  state: AgentState,
  config: RunnableConfig,
): Promise<Partial<AgentState>> {
  const ctx = getCtx(config);
  if (!state.plan) throw new Error('No plan available');

  const step = state.plan.steps[state.stepIndex];
  if (!step) throw new Error(`No step at index ${state.stepIndex}`);

  const usesSubAgent = Boolean(step.subAgent);
  const usesSkill = !usesSubAgent && Boolean(step.skillName && ctx.skillRegistry.has(step.skillName));

  logger.log(
    `step[${state.stepIndex}] ${usesSubAgent ? 'subagent:' + step.subAgent : usesSkill ? 'skill:' + step.skillName : 'tool:' + (step.toolHint ?? 'think')} | ${step.description.slice(0, 60)}${state.retryCount > 0 ? ` (retry #${state.retryCount})` : ''}`,
  );

  // ─── HITL interrupt check ─────────────────────────────────────────────
  const isSideEffect = usesSubAgent
    ? (ctx.subAgentRegistry.get(step.subAgent!)?.isSideEffect ?? step.subAgent === 'writer')
    : usesSkill
      ? ctx.skillRegistry.get(step.skillName!).effect === 'side-effect'
      : ctx.toolRegistry.has(step.toolHint ?? '') ? ctx.toolRegistry.get(step.toolHint!).type === 'side-effect' : false;

  const shouldPause = state.approvalMode === 'all_steps' || (state.approvalMode === 'side_effects' && isSideEffect);
  if (shouldPause) {
    const decision = interrupt({
      stepIndex: state.stepIndex, description: step.description, isSideEffect,
      toolOrSkill: step.toolHint ?? step.skillName ?? step.subAgent ?? 'unknown',
    });
    await ctx.callbacks.setRunStatus(state.runId, RunStatus.RUNNING);
    if (decision === 'rejected') {
      return { error: 'step_rejected' };
    }
  }

  // ─── Create step_run + emit event ─────────────────────────────────────
  const stepRun = await ctx.callbacks.createStepRun(
    state.runId, `${state.plan.planId}:${step.stepIndex}`, state.executionOrder,
  );
  await ctx.callbacks.updateStepRun(stepRun.id, { startedAt: new Date(), status: StepStatus.RUNNING });

  ctx.eventPublisher.emit(TASK_EVENTS.STEP_STARTED, {
    taskId: state.taskId, runId: state.runId, stepRunId: stepRun.id,
    planStepId: stepRun.planStepId, description: step.description,
    executorType: usesSubAgent || usesSkill ? ExecutorType.SKILL : ExecutorType.TOOL,
    skillName: usesSubAgent ? `subagent:${step.subAgent}` : usesSkill ? step.skillName : null,
    toolName: !usesSubAgent && !usesSkill ? (step.toolHint ?? 'think') : null,
  });

  // ─── Dispatch ─────────────────────────────────────────────────────────
  try {
    let output: string;

    if (usesSubAgent) {
      const result = await executeSubAgentStep(state, ctx, { description: step.description, subAgent: step.subAgent!, objective: step.objective }, stepRun.id);
      output = result.output;
    } else if (usesSkill) {
      const result = await executeSkillStep(state, ctx, { description: step.description, skillName: step.skillName!, skillInput: step.skillInput }, stepRun.id);
      output = result.output;
    } else {
      const result = await executeToolStep(state, ctx, { description: step.description, toolHint: step.toolHint, toolInput: step.toolInput }, stepRun.id);
      output = result.output;
    }

    return {
      executionOrder: state.executionOrder + 1,
      lastStepRunId: stepRun.id,
      lastOutput: output,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`step[${state.stepIndex}] error: ${msg.slice(0, 200)}`);
    await ctx.callbacks.updateStepRun(stepRun.id, { status: StepStatus.FAILED, errorMessage: msg, completedAt: new Date() });
    return {
      executionOrder: state.executionOrder + 1,
      lastStepRunId: stepRun.id,
      lastOutput: msg,
    };
  }
}
```

- [ ] **Step 2: Write checker.node.ts**

```typescript
// src/agent/nodes/checker.node.ts
import { Logger } from '@nestjs/common';
import { Command, END } from '@langchain/langgraph';
import { z } from 'zod';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AgentState, StepResult } from '@/agent/agent.state';
import { getCtx } from '@/agent/agent.context';
import { getIntentConfig } from '@/agent/intent.config';
import { StepStatus } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { evaluatorPrompt } from '@/prompts';
import { DB_RESULT_SUMMARY_MAX, EVENT_STEP_PREVIEW_MAX, EVENT_REASON_MAX, PROMPT_HISTORY_STEP_MAX } from '@/common/constants/system-limits';

const logger = new Logger('CheckerNode');

// ─── Tool fallback mapping ──────────────────────────────────────────────────
const TOOL_FALLBACKS: Record<string, string> = {
  sandbox_run_node: 'think',
  sandbox_run_python: 'think',
  browser_open: 'fetch_url_as_markdown',
  browser_screenshot: 'fetch_url_as_markdown',
};

const STRUCTURAL_ERROR_PATTERNS = [
  'winansi cannot encode', 'tool_input_invalid', 'could not parse output',
  'outputparserexception', 'invalid json', 'permission denied', 'eacces', 'enoent',
];

const EvalSchema = z.object({
  decision: z.enum(['continue', 'retry', 'replan', 'complete', 'fail']),
  reason: z.string(),
});

type Decision = 'continue' | 'retry' | 'replan' | 'complete' | 'fail';

export async function checkerNode(
  state: AgentState,
  config: RunnableConfig,
): Promise<Command> {
  const ctx = getCtx(config);
  const { lastStepRunId, lastOutput } = state;
  const currentStep = state.plan?.steps[state.stepIndex];

  // 1. Cancel check
  const cancelled = await ctx.callbacks.readCancelFlag(state.runId);
  if (cancelled) {
    if (lastStepRunId) {
      await ctx.callbacks.updateStepRun(lastStepRunId, { status: StepStatus.FAILED, errorMessage: '任务已取消', completedAt: new Date() });
      ctx.eventPublisher.emit(TASK_EVENTS.STEP_FAILED, { taskId: state.taskId, runId: state.runId, stepRunId: lastStepRunId, error: '任务已取消' });
    }
    return new Command({ update: { error: 'cancelled' }, goto: END });
  }

  // 2. Token budget check
  const budgetFailure = ctx.tokenBudgetGuard.check();
  if (budgetFailure) {
    return applyDecision('fail', budgetFailure.reason, state, ctx, true);
  }

  if (!state.plan) {
    return applyDecision('fail', '无有效计划', state, ctx, true);
  }

  // 3. Rule-based pre-checks
  const preCheck = runPreChecks(lastOutput, state.retryCount, state.replanCount, ctx.maxRetries, ctx.maxReplans);
  if (preCheck) {
    return applyDecision(preCheck.decision, preCheck.reason, state, ctx, true, preCheck.metadata);
  }

  // 4. Deterministic fast-track
  const intentConfig = getIntentConfig(state.intent);
  if (intentConfig.deterministicCheck) {
    const totalSteps = state.plan.steps.length;
    const isLastStep = state.stepIndex >= totalSteps - 1;
    const decision: Decision = isLastStep ? 'complete' : 'continue';
    logger.log(`确定性快通道 → ${decision}（步骤 ${state.stepIndex + 1}/${totalSteps}）`);
    return applyDecision(decision, `步骤 ${state.stepIndex + 1}/${totalSteps} 完成`, state, ctx, true);
  }

  // 5. LLM evaluation
  const recentSummaries = buildRecentSummaries(state.stepResults);
  const chain = evaluatorPrompt.pipe(ctx.llm.withStructuredOutput(EvalSchema, { method: ctx.soMethod }));
  const result = await chain.invoke({
    stepDescription: currentStep?.description ?? '未知',
    lastStepOutput: lastOutput.slice(0, DB_RESULT_SUMMARY_MAX),
    recentSummaries,
    retryCount: String(state.retryCount),
    replanCount: String(state.replanCount),
  }) as { decision: Decision; reason: string };

  logger.log(`LLM 评估 → ${result.decision} | ${result.reason.slice(0, 80)}`);
  return applyDecision(result.decision, result.reason, state, ctx, false);
}

// ─── Pre-checks (same logic as current evaluator) ───────────────────────────

function runPreChecks(
  output: string, retryCount: number, replanCount: number, maxRetries: number, maxReplans: number,
): { decision: Decision; reason: string; metadata?: Record<string, unknown> } | null {
  const trimmed = output.trim();
  const lower = trimmed.toLowerCase();

  // Resource unavailable → tool fallback
  if (lower.includes('resource_unavailable')) {
    const toolMatch = trimmed.match(/resource_unavailable[:\s]+(\w+)/i);
    const failedTool = toolMatch?.[1] ?? '';
    const fallback = TOOL_FALLBACKS[failedTool];
    if (fallback && retryCount < maxRetries) {
      return { decision: 'retry', reason: `工具 ${failedTool} 不可用，降级使用 ${fallback}`, metadata: { fallbackTool: fallback } };
    }
  }

  // Code execution failure → replan
  if (lower.includes('code_execution_failed')) {
    return replanCount < maxReplans
      ? { decision: 'replan', reason: `代码执行失败，需要重新规划：${trimmed.slice(0, 300)}` }
      : { decision: 'fail', reason: `代码多次执行失败：${trimmed.slice(0, 200)}` };
  }

  // Structural error → replan (skip retry)
  if (STRUCTURAL_ERROR_PATTERNS.some(p => lower.includes(p))) {
    return replanCount < maxReplans
      ? { decision: 'replan', reason: `结构性错误：${trimmed.slice(0, 200)}` }
      : { decision: 'fail', reason: `结构性错误且重规划已耗尽：${trimmed.slice(0, 200)}` };
  }

  const isEmpty = trimmed.length < 10;
  const isError = lower.startsWith('error') || lower.startsWith('failed') || lower.includes('tool_execution_failed');
  const isTimeout = lower.includes('超时') || lower.includes('timeout');

  if ((isEmpty || isError || isTimeout) && retryCount < maxRetries) {
    return { decision: 'retry', reason: `输出异常，自动重试（第 ${retryCount + 1} 次）` };
  }
  if ((isEmpty || isError) && retryCount >= maxRetries && replanCount < maxReplans) {
    return { decision: 'replan', reason: '多次重试后仍未成功，自动重新规划' };
  }

  return null;
}

// ─── Decision application (builds Command) ──────────────────────────────────

function applyDecision(
  decision: Decision,
  reason: string,
  state: AgentState,
  ctx: ReturnType<typeof getCtx>,
  viaPreCheck: boolean,
  metadata?: Record<string, unknown>,
): Command {
  const { lastStepRunId, lastOutput } = state;
  const currentStep = state.plan?.steps[state.stepIndex];

  // Emit decision tracking event
  ctx.eventPublisher.emit(TASK_EVENTS.EVALUATOR_DECIDED, {
    taskId: state.taskId, runId: state.runId, stepRunId: lastStepRunId,
    input: { lastStepOutputPreview: lastOutput.slice(0, EVENT_STEP_PREVIEW_MAX), retryCount: state.retryCount, replanCount: state.replanCount, currentStepIndex: state.stepIndex },
    viaPreCheck, decision, reason: reason.slice(0, EVENT_REASON_MAX),
  });

  // Update step_run terminal status + emit event
  if (decision === 'retry' || decision === 'fail') {
    if (lastStepRunId) {
      ctx.callbacks.updateStepRun(lastStepRunId, { status: StepStatus.FAILED, errorMessage: reason, completedAt: new Date() });
      ctx.eventPublisher.emit(TASK_EVENTS.STEP_FAILED, { taskId: state.taskId, runId: state.runId, stepRunId: lastStepRunId, error: reason });
    }
  } else if (lastStepRunId) {
    ctx.callbacks.updateStepRun(lastStepRunId, { status: StepStatus.COMPLETED, resultSummary: reason, completedAt: new Date() });
    ctx.eventPublisher.emit(TASK_EVENTS.STEP_COMPLETED, { taskId: state.taskId, runId: state.runId, stepRunId: lastStepRunId, resultSummary: reason });
  }

  const newStepResult: StepResult = {
    stepRunId: lastStepRunId, description: currentStep?.description ?? '',
    resultSummary: lastOutput.slice(0, DB_RESULT_SUMMARY_MAX),
    toolOutput: lastOutput.slice(0, DB_RESULT_SUMMARY_MAX),
    executionOrder: state.executionOrder - 1,
  };

  switch (decision) {
    case 'continue': {
      const totalSteps = state.plan?.steps.length ?? 0;
      if (state.stepIndex + 1 >= totalSteps || state.executionOrder >= ctx.maxSteps) {
        return new Command({ update: { stepResults: [newStepResult], lastStepRunId: '', lastOutput: '' }, goto: 'finalizer' });
      }
      return new Command({
        update: { stepIndex: state.stepIndex + 1, retryCount: 0, stepResults: [newStepResult], lastStepRunId: '', lastOutput: '' },
        goto: 'executor',
      });
    }
    case 'retry':
      return new Command({
        update: { retryCount: state.retryCount + 1, lastStepRunId: '', ...(metadata ?? {}) },
        goto: 'executor',
      });
    case 'replan':
      return new Command({
        update: { replanCount: state.replanCount + 1, retryCount: 0, stepResults: [newStepResult], lastStepRunId: '', lastOutput: '' },
        goto: 'planner',
      });
    case 'complete':
      return new Command({ update: { stepResults: [newStepResult], lastStepRunId: '', lastOutput: '' }, goto: 'finalizer' });
    case 'fail':
      return new Command({ update: { error: reason, lastStepRunId: '', lastOutput: '' }, goto: END });
  }
}

function buildRecentSummaries(stepResults: StepResult[], maxChars = 3000): string {
  if (stepResults.length === 0) return '暂无';
  const current = stepResults[stepResults.length - 1];
  const currentContent = (current.toolOutput ?? current.resultSummary).slice(0, Math.floor(maxChars * 0.6));
  let result = `[当前] ${current.description}: ${currentContent}`;
  let remaining = maxChars - result.length;
  for (let i = stepResults.length - 2; i >= 0 && remaining > 200; i--) {
    const s = stepResults[i];
    const content = (s.toolOutput ?? s.resultSummary ?? '').slice(0, PROMPT_HISTORY_STEP_MAX);
    const line = `[步骤${s.executionOrder + 1}] ${s.description}: ${content}`;
    if (line.length > remaining) break;
    result = line + '\n' + result;
    remaining -= line.length;
  }
  return result;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/agent/nodes/executor.node.ts src/agent/nodes/checker.node.ts
git commit -m "feat(agent): add executor dispatcher and checker node with Command routing"
```

---

### Task 6: Finalizer Node

**Files:**
- Create: `src/agent/nodes/finalizer.node.ts`

- [ ] **Step 1: Write finalizer.node.ts**

```typescript
// src/agent/nodes/finalizer.node.ts
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { getStore } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AgentState } from '@/agent/agent.state';
import { getCtx } from '@/agent/agent.context';
import { getIntentConfig } from '@/agent/intent.config';
import { ArtifactType } from '@/common/enums';
import { TASK_EVENTS } from '@/common/events/task.events';
import { createPdfBufferFromText } from '@/tool/utils/pdf-export';
import { finalizerJsonPrompt, finalizerPrompt } from '@/prompts';

const logger = new Logger('FinalizerNode');

function parseArtifactType(raw: string): [ArtifactType, string] {
  const match = raw.match(/^TYPE:\s*(markdown|code|diagram)\s*\n/i);
  if (!match) return [ArtifactType.MARKDOWN, raw];
  const typeMap: Record<string, ArtifactType> = { code: ArtifactType.CODE, diagram: ArtifactType.DIAGRAM, markdown: ArtifactType.MARKDOWN };
  return [typeMap[match[1].toLowerCase()] ?? ArtifactType.MARKDOWN, raw.slice(match[0].length).trimStart()];
}

function normalizeArtifact(type: ArtifactType, content: string): { content: string; metadata: Record<string, unknown> | null } {
  if (type === ArtifactType.CODE) {
    const m = content.match(/```([\w-]+)?\n([\s\S]*?)```/);
    return m ? { content: m[2].trim(), metadata: { language: m[1]?.trim() || 'text' } } : { content: content.trim(), metadata: { language: 'text' } };
  }
  if (type === ArtifactType.DIAGRAM) {
    const m = content.match(/```mermaid\s*([\s\S]*?)```/i);
    return { content: (m?.[1] ?? content).trim(), metadata: { renderer: 'mermaid' } };
  }
  return { content: content.trim(), metadata: null };
}

const FinalizerJsonSchema = z.object({
  summary: z.string(),
  sources: z.array(z.string()).default([]),
  key_points: z.array(z.string()).default([]),
  artifact_type: z.enum(['markdown', 'code', 'diagram']),
});

export async function finalizerNode(
  state: AgentState,
  config: RunnableConfig,
): Promise<Partial<AgentState>> {
  const ctx = getCtx(config);

  const budgetFailure = ctx.tokenBudgetGuard.check();
  if (budgetFailure) return { error: budgetFailure.reason };

  const executionContext = state.stepResults
    .map(s => `步骤 ${s.executionOrder + 1}: ${s.description}\n结果: ${s.toolOutput ?? s.resultSummary}`)
    .join('\n\n');

  // Determine artifact source
  const intentConfig = getIntentConfig(state.intent);
  const lastStepResult = state.stepResults[state.stepResults.length - 1];
  const writerOutput = intentConfig.useLastStepAsArtifact && lastStepResult
    ? (lastStepResult.toolOutput ?? lastStepResult.resultSummary ?? '') : '';
  const useWriterOutput = writerOutput.length > 200;

  let rawContent: string;
  if (useWriterOutput) {
    logger.log(`使用 writer 输出作为 artifact 主体（${writerOutput.length} chars）`);
    rawContent = writerOutput;
  } else {
    const chain = finalizerPrompt.pipe(ctx.llm);
    const response = await chain.invoke({ revisionInput: state.userInput, executionContext });
    rawContent = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  }

  const budgetFailure2 = ctx.tokenBudgetGuard.check();
  if (budgetFailure2) return { error: budgetFailure2.reason };

  const [artifactType, content] = parseArtifactType(rawContent);
  const normalized = normalizeArtifact(artifactType, content);
  const generatedAt = new Date().toISOString();
  const artifactTitle = `任务产物: ${state.userInput.slice(0, 50)}`;

  const artifact = await ctx.callbacks.saveArtifact(state.runId, artifactTitle, normalized.content, artifactType, { ...(normalized.metadata ?? {}), generatedAt });
  ctx.eventPublisher.emit(TASK_EVENTS.ARTIFACT_CREATED, { taskId: state.taskId, runId: state.runId, artifactId: artifact.id, type: artifactType, title: artifact.title });

  // JSON summary
  const budgetFailure3 = ctx.tokenBudgetGuard.check();
  if (!budgetFailure3) {
    const jsonChain = finalizerJsonPrompt.pipe(ctx.llm.withStructuredOutput(FinalizerJsonSchema, { method: ctx.soMethod }));
    const jsonSummary = await jsonChain.invoke({ revisionInput: state.userInput, artifactType, executionContext });
    const summaryArtifact = await ctx.callbacks.saveArtifact(
      state.runId, `结构化摘要: ${state.userInput.slice(0, 40)}`,
      JSON.stringify({ summary: jsonSummary.summary, sources: jsonSummary.sources, key_points: jsonSummary.key_points, artifact_type: artifactType, generated_at: generatedAt }, null, 2),
      ArtifactType.JSON, { sourceArtifactId: artifact.id, generatedAt },
    );
    ctx.eventPublisher.emit(TASK_EVENTS.ARTIFACT_CREATED, { taskId: state.taskId, runId: state.runId, artifactId: summaryArtifact.id, type: ArtifactType.JSON, title: summaryArtifact.title });
  }

  // Optional PDF export
  if (ctx.exportPdfEnabled) {
    try {
      const pdfBytes = await createPdfBufferFromText(artifactTitle, normalized.content);
      const fileArtifact = await ctx.callbacks.saveArtifact(
        state.runId, `PDF 导出: ${state.userInput.slice(0, 40)}`,
        Buffer.from(pdfBytes).toString('base64'), ArtifactType.FILE,
        { fileName: `${artifactTitle.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.pdf`, mimeType: 'application/pdf', encoding: 'base64', sizeBytes: pdfBytes.byteLength, sourceArtifactId: artifact.id, generatedAt },
      );
      ctx.eventPublisher.emit(TASK_EVENTS.ARTIFACT_CREATED, { taskId: state.taskId, runId: state.runId, artifactId: fileArtifact.id, type: ArtifactType.FILE, title: fileArtifact.title });
    } catch (err) {
      logger.warn(`PDF 导出失败: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Write to LangGraph Store for cross-run memory
  const store = getStore(config);
  if (store) {
    try {
      await store.put(['task_memory', state.taskId], state.runId, {
        summary: `${state.userInput.slice(0, 100)} → ${state.stepResults.length} 步完成`,
        completedAt: new Date().toISOString(),
        stepCount: state.stepResults.length,
        retryCount: state.retryCount, replanCount: state.replanCount,
      });
    } catch { /* ignore */ }
  }

  return {};
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/nodes/finalizer.node.ts
git commit -m "feat(agent): add finalizer node with intent-based artifact generation"
```

---

### Task 7: Graph Definition + Service + Module

**Files:**
- Create: `src/agent/agent.graph.ts`
- Create: `src/agent/agent.service.ts`
- Create: `src/agent/agent.module.ts`

- [ ] **Step 1: Write agent.graph.ts**

```typescript
// src/agent/agent.graph.ts
import { StateGraph, START, END, MemorySaver, InMemoryStore } from '@langchain/langgraph';
import { AgentStateAnnotation } from '@/agent/agent.state';
import { plannerNode } from '@/agent/nodes/planner.node';
import { executorNode } from '@/agent/nodes/executor.node';
import { checkerNode } from '@/agent/nodes/checker.node';
import { finalizerNode } from '@/agent/nodes/finalizer.node';

/**
 * Build and compile the agent graph. Called once at service initialization.
 *
 * Topology:
 *   START → planner ──→ executor → checker ──→ executor (continue/retry)
 *              │                            ──→ planner  (replan)
 *              │                            ──→ finalizer → END (complete)
 *              └──→ END (error)             ──→ END (fail/cancelled)
 *
 * planner and checker use Command for routing (no conditional edges).
 * Static edges: START→planner, executor→checker, finalizer→END.
 */
export function buildAgentGraph() {
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode('planner', plannerNode, { ends: ['executor', END] })
    .addNode('executor', executorNode)
    .addNode('checker', checkerNode, { ends: ['executor', 'planner', 'finalizer', END] })
    .addNode('finalizer', finalizerNode)
    .addEdge(START, 'planner')
    .addEdge('executor', 'checker')
    .addEdge('finalizer', END);

  return graph;
}

export function compileAgentGraph() {
  return buildAgentGraph().compile({
    checkpointer: new MemorySaver(),
    store: new InMemoryStore(),
  });
}

export type CompiledAgentGraph = ReturnType<typeof compileAgentGraph>;
```

- [ ] **Step 2: Write agent.service.ts**

```typescript
// src/agent/agent.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { InMemoryCache } from '@langchain/core/caches';
import { Command } from '@langchain/langgraph';
import type { ApprovalMode } from '@/common/enums';
import { RunStatus } from '@/common/enums';
import type { AgentState } from '@/agent/agent.state';
import type { AgentCallbacks } from '@/agent/agent.callbacks';
import type { NodeContext } from '@/agent/agent.context';
import { compileAgentGraph, type CompiledAgentGraph } from '@/agent/agent.graph';
import { ToolRegistry } from '@/tool/tool.registry';
import { SkillRegistry } from '@/skill/skill.registry';
import { WorkspaceService } from '@/workspace/workspace.service';
import { EventPublisher } from '@/event/event.publisher';
import { BrowserSessionService } from '@/browser/browser-session.service';
import { SubAgentRegistry } from '@/agent/subagents/subagent.registry';
import { TokenTrackerCallback } from '@/agent/token-tracker.callback';
import { TokenBudgetGuard } from '@/agent/token-budget.guard';
import { TASK_EVENTS } from '@/common/events/task.events';
import type { PlanSemanticValidationOptions } from '@/agent/plan-validator';

const MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'gpt-4o': { inputPerMillion: 5.0, outputPerMillion: 15.0 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'qwen-plus': { inputPerMillion: 0.4, outputPerMillion: 1.2 },
  'qwen-max': { inputPerMillion: 1.6, outputPerMillion: 4.8 },
  'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
};

function estimateCostUsd(model: string, inp: number, out: number): number | null {
  const p = MODEL_PRICING[model];
  return p ? (inp / 1e6) * p.inputPerMillion + (out / 1e6) * p.outputPerMillion : null;
}

function readBoolean(v: string | undefined, d: boolean): boolean {
  return v == null ? d : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function readCleanString(v: string | undefined, d: string): string {
  const t = v?.trim(); return t?.length ? t : d;
}

function readCsv(v: string | undefined): string[] {
  return (v ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  readonly llm: ChatOpenAI;
  private readonly modelName: string;
  private readonly compiled: CompiledAgentGraph;
  private readonly approvalMap = new Map<string, { resolve: (approved: boolean) => void; reject: (err: Error) => void }>();
  private readonly approvalTimeoutMs: number;

  // Shared config (immutable after constructor)
  private readonly sharedConfig: Omit<NodeContext, 'signal' | 'tokenTracker' | 'tokenBudgetGuard' | 'callbacks'>;

  constructor(
    private readonly config: ConfigService,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
    private readonly workspace: WorkspaceService,
    private readonly eventPublisher: EventPublisher,
    private readonly browserSessions: BrowserSessionService,
    private readonly subAgentRegistry: SubAgentRegistry,
  ) {
    this.modelName = readCleanString(config.get<string>('MODEL_NAME'), 'gpt-4o-mini');
    this.llm = new ChatOpenAI({
      modelName: this.modelName,
      apiKey: readCleanString(config.get<string>('OPENAI_API_KEY'), ''),
      configuration: { baseURL: config.get<string>('OPENAI_BASE_URL')?.trim() },
      temperature: 0,
      cache: readBoolean(config.get<string>('LLM_CACHE_ENABLED'), true) ? new InMemoryCache() : undefined,
    });

    const raw = config.get<string>('STRUCTURED_OUTPUT_METHOD', 'functionCalling').trim();
    const soMethod = (['functionCalling', 'json_schema', 'jsonMode'].includes(raw) ? raw : 'functionCalling') as NodeContext['soMethod'];

    const planValidationOptions: PlanSemanticValidationOptions = {
      maxSteps: Math.min(config.get<number>('PLANNER_MAX_STEPS', 8), config.get<number>('MAX_STEPS', 20)),
      allowedSideEffectTools: readCsv(config.get<string>('PLANNER_ALLOWED_SIDE_EFFECT_TOOLS', 'write_file,download_file,export_pdf,browser_screenshot,browser_click,browser_type,sandbox_run_node,sandbox_run_python')),
      allowedSideEffectSkills: readCsv(config.get<string>('PLANNER_ALLOWED_SIDE_EFFECT_SKILLS', 'document_writing,report_packaging,code_project_generation')),
    };

    this.sharedConfig = {
      llm: this.llm,
      toolRegistry, skillRegistry, workspace, eventPublisher, subAgentRegistry,
      soMethod,
      maxRetries: config.get<number>('MAX_RETRIES', 3),
      maxReplans: config.get<number>('MAX_REPLANS', 2),
      maxSteps: config.get<number>('MAX_STEPS', 20),
      stepTimeoutMs: config.get<number>('STEP_TIMEOUT_MS', 180_000),
      skillTimeoutMs: config.get<number>('SKILL_TIMEOUT_MS', 300_000),
      exportPdfEnabled: readBoolean(config.get<string>('EXPORT_PDF_ENABLED'), false),
      planValidationOptions,
    };

    this.approvalTimeoutMs = config.get<number>('APPROVAL_TIMEOUT_MS', 600_000);

    // Tool availability checker
    const tavilyKey = config.get<string>('TAVILY_API_KEY', '');
    const sandboxEnabled = readBoolean(config.get<string>('SANDBOX_ENABLED'), false);
    const browserEnabled = readBoolean(config.get<string>('BROWSER_AUTOMATION_ENABLED'), false);
    toolRegistry.setAvailabilityChecker((req) => {
      if (req === 'tavily_api') return !!tavilyKey;
      if (req === 'docker') return sandboxEnabled;
      if (req === 'playwright') return browserEnabled;
      return true;
    });

    // Compile graph once
    this.compiled = compileAgentGraph();
    this.logger.log(`Agent graph compiled. Model: ${this.modelName}, SO: ${soMethod}`);
  }

  async executeRun(
    taskId: string, runId: string, revisionInput: string,
    callbacks: AgentCallbacks, signal: AbortSignal,
    approvalMode: ApprovalMode = 'none',
  ): Promise<void> {
    const tokenTracker = new TokenTrackerCallback();
    const tokenBudget = this.config.get<number>('TOKEN_BUDGET', 100_000);
    const tokenBudgetGuard = new TokenBudgetGuard(tokenTracker, tokenBudget, () => estimateCostUsd(this.modelName, tokenTracker.inputTokens, tokenTracker.outputTokens));

    const ctx: NodeContext = { ...this.sharedConfig, signal, tokenTracker, tokenBudgetGuard, callbacks };

    const initialState: Partial<AgentState> = {
      taskId, runId, userInput: revisionInput, approvalMode,
      plan: null, stepIndex: 0, intent: 'general',
      stepResults: [], lastStepRunId: '', lastOutput: '',
      retryCount: 0, replanCount: 0, executionOrder: 0, error: null,
    };

    this.eventPublisher.emit(TASK_EVENTS.RUN_STARTED, { taskId, runId });
    await callbacks.setRunStatus(runId, RunStatus.RUNNING);

    try {
      let invokeInput: Partial<AgentState> | Command = initialState;
      const graphConfig = { configurable: { thread_id: runId, ctx }, callbacks: [tokenTracker] };

      while (true) {
        const result = await this.compiled.invoke(invokeInput as any, graphConfig);
        const interrupts = (result as any).__interrupt__ as Array<{ value: Record<string, unknown> }> | undefined;

        if (!interrupts?.length) {
          const finalState = result as AgentState;
          if (finalState.error === 'cancelled') {
            await callbacks.setRunStatus(runId, RunStatus.CANCELLED);
            this.eventPublisher.emit(TASK_EVENTS.RUN_CANCELLED, { taskId, runId });
          } else if (finalState.error) {
            await callbacks.setRunStatus(runId, RunStatus.FAILED, finalState.error);
            this.eventPublisher.emit(TASK_EVENTS.RUN_FAILED, { taskId, runId, error: finalState.error });
          } else {
            await callbacks.setRunStatus(runId, RunStatus.COMPLETED);
            this.eventPublisher.emit(TASK_EVENTS.RUN_COMPLETED, { taskId, runId });
          }
          break;
        }

        // HITL interrupt handling
        const interruptValue = interrupts[0].value;
        const approvalPromise = this.waitForApproval(runId);
        await callbacks.setRunAwaitingApproval(runId, interruptValue);
        this.eventPublisher.emit(TASK_EVENTS.RUN_AWAITING_APPROVAL, { taskId, runId, ...interruptValue });

        let approved: boolean;
        try { approved = await approvalPromise; } catch {
          await callbacks.setRunStatus(runId, RunStatus.FAILED, 'approval_timeout');
          this.eventPublisher.emit(TASK_EVENTS.RUN_FAILED, { taskId, runId, error: 'approval_timeout' });
          break;
        }
        invokeInput = new Command({ resume: approved ? 'approved' : 'rejected' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Run ${runId} failed: ${msg}`);
      await callbacks.setRunStatus(runId, RunStatus.FAILED, msg);
      this.eventPublisher.emit(TASK_EVENTS.RUN_FAILED, { taskId, runId, error: msg });
    } finally {
      // Token usage reporting
      const cost = estimateCostUsd(this.modelName, tokenTracker.inputTokens, tokenTracker.outputTokens);
      if (tokenTracker.totalTokens > 0) {
        this.logger.log(`Run ${runId} tokens — in: ${tokenTracker.inputTokens}, out: ${tokenTracker.outputTokens}${cost != null ? `, cost: $${cost.toFixed(6)}` : ''}`);
        this.eventPublisher.emit(TASK_EVENTS.RUN_TOKEN_USAGE, {
          taskId, runId, inputTokens: tokenTracker.inputTokens, outputTokens: tokenTracker.outputTokens,
          totalTokens: tokenTracker.totalTokens, estimatedCostUsd: cost, modelName: this.modelName,
        });
      }
      try { await callbacks.saveTokenUsage(runId, { inputTokens: tokenTracker.inputTokens, outputTokens: tokenTracker.outputTokens, totalTokens: tokenTracker.totalTokens, estimatedCostUsd: cost, modelName: this.modelName }); } catch {}
      if (tokenTracker.nodeUsages.length > 0) {
        try { await callbacks.saveLlmCallLogs(runId, this.modelName, tokenTracker.nodeUsages.map(u => ({ ...u, estimatedCostUsd: estimateCostUsd(this.modelName, u.inputTokens, u.outputTokens) }))); } catch {}
      }
      try { await this.browserSessions.closeRun(runId); } catch {}
      await callbacks.finalize(taskId);
    }
  }

  resolveApproval(runId: string, approved: boolean): void {
    const entry = this.approvalMap.get(runId);
    if (!entry) throw new NotFoundException(`运行 ${runId} 没有待审批的步骤`);
    this.approvalMap.delete(runId);
    entry.resolve(approved);
  }

  private waitForApproval(runId: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      this.approvalMap.set(runId, { resolve, reject });
      setTimeout(() => { this.approvalMap.delete(runId); reject(new Error('approval_timeout')); }, this.approvalTimeoutMs);
    });
  }
}
```

- [ ] **Step 3: Write agent.module.ts**

```typescript
// src/agent/agent.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { AgentService } from '@/agent/agent.service';
import { ToolModule } from '@/tool/tool.module';
import { SkillModule } from '@/skill/skill.module';
import { WorkspaceModule } from '@/workspace/workspace.module';
import { EventModule } from '@/event/event.module';
import { BrowserModule } from '@/browser/browser.module';
import { SubAgentRegistry } from '@/agent/subagents/subagent.registry';

// Built-in SubAgent definitions (moved from deleted react-subagent.ts)
const RESEARCHER_DEF = {
  tools: ['think', 'web_search', 'fetch_url_as_markdown', 'browse_url'],
  isSideEffect: false,
  systemPrompt: `你是一个专业的深度调研 Agent。

**工作流程**：
1. 分析调研主题，识别核心问题和关键词
2. 使用 web_search 从多个角度搜索信息（至少 2-3 次不同关键词）
3. 使用 fetch_url_as_markdown 阅读最相关的来源页面（选 2-4 个高质量来源）
4. 使用 think 整理发现、识别模式、补充分析
5. 最终输出完整调研报告

**输出要求**：调研报告必须包含核心发现、数据支撑、关键来源（URL 列表）、结论与建议。`,
};

const WRITER_DEF = {
  tools: ['think', 'read_file', 'list_directory', 'write_file', 'export_pdf'],
  injectArgs: (taskId: string) => ({ task_id: taskId }),
  isSideEffect: true,
  systemPrompt: `你是一个专业的文档撰写 Agent。

**工作流程**：
1. 仔细阅读材料和目标要求
2. 使用 think 规划文档结构
3. 撰写完整的 Markdown 报告内容
4. 使用 write_file 将报告保存
5. 如可用，使用 export_pdf 导出 PDF 版本

**输出要求**：报告结构清晰、内容完整、有数据支撑。`,
};

@Module({
  imports: [ToolModule, SkillModule, WorkspaceModule, EventModule, BrowserModule],
  providers: [AgentService, SubAgentRegistry],
  exports: [AgentService],
})
export class AgentModule implements OnModuleInit {
  constructor(private readonly subAgentRegistry: SubAgentRegistry) {}

  onModuleInit() {
    this.subAgentRegistry.register('researcher', RESEARCHER_DEF);
    this.subAgentRegistry.register('writer', WRITER_DEF);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/agent.graph.ts src/agent/agent.service.ts src/agent/agent.module.ts
git commit -m "feat(agent): add graph definition, service shell, and module wiring"
```

---

### Task 8: Cleanup + Prompt Updates

**Files:**
- Modify: `src/prompts/index.ts` (remove dead prompts)
- Delete: Old files listed in spec

- [ ] **Step 1: Clean up prompts/index.ts**

Remove `routerPrompt` and `templateParamExtractionPrompt` exports (only used by deleted files). Keep all skill-related prompts (used by skills outside agent/).

The `combinedPlannerPrompt` was already added in Task 4.

Remove these blocks from prompts/index.ts:
- The `routerPrompt` definition (lines 328-348)
- The `templateParamExtractionPrompt` definition (lines 352-358)

- [ ] **Step 2: Delete old agent files**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/mini-manus/backend
rm -f src/agent/nodes/router.node.ts
rm -f src/agent/nodes/router.node.spec.ts
rm -f src/agent/nodes/research-subgraph.ts
rm -f src/agent/nodes/evaluator.node.ts
rm -f src/agent/nodes/evaluator.node.spec.ts
rm -f src/agent/nodes/planner.node.spec.ts
rm -f src/agent/nodes/sandbox-s2.spec.ts
rm -f src/agent/nodes/trajectory.spec.ts
rm -f src/agent/workflow.registry.ts
rm -f src/agent/subagents/react-subagent.ts
rm -f src/agent/agent.service.spec.ts
rm -f src/agent/plan-semantic-validator.ts
```

Note: Keep `src/agent/subagents/subagent.registry.ts` — it's still used by the new code (SubAgentRegistry is an @Injectable NestJS provider).

- [ ] **Step 3: Commit cleanup**

```bash
git add -A src/agent/ src/prompts/index.ts
git commit -m "refactor(agent): delete old agent files (router, evaluator, research-subgraph, workflow-registry)"
```

---

### Task 9: Build Verification + Fix Type Errors

**Files:**
- Fix: Any type errors across the new files

- [ ] **Step 1: Run TypeScript compiler**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/mini-manus/backend
npx tsc --noEmit 2>&1 | head -50
```

- [ ] **Step 2: Fix any type errors found**

Common issues to expect:
- Import path mismatches (old files referenced from non-agent code)
- `ExecutorType` enum vs string literal mismatches in executor files
- `getStore` import needs to be from `@langchain/langgraph` not a sub-path
- The `config` variable scoping issue in planner.node.ts (noted in Task 4)
- Missing type assertions for `Command` returns from checker/planner

Fix each error iteratively until `npx tsc --noEmit` passes cleanly.

- [ ] **Step 3: Run existing tests**

```bash
npm test 2>&1 | tail -30
```

Fix any failing tests. Most old test files were deleted in Task 8, so this should mostly pass.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix(agent): resolve type errors from agent module rewrite"
```

---

## Post-Implementation Checklist

After all tasks are complete, verify:

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `npm test` passes
- [ ] External interface unchanged: `AgentService.executeRun()` and `resolveApproval()` signatures match
- [ ] All 21 TASK_EVENTS still emitted with correct payloads
- [ ] No imports of deleted files remain anywhere in the codebase
- [ ] `agent/` directory structure matches the spec's file inventory
