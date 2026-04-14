# Agent Module Rewrite Design Spec

## Background

The current agent module (~3,200 lines) has accumulated structural problems:

- **Graph rebuilt per-run** instead of compile-once-invoke-many
- **Node functions take 8-12 parameters** instead of using `config.configurable`
- **executorNode is 669 lines** doing 3 unrelated execution paths (tool/skill/subagent)
- **Router is a redundant hop** — one extra LLM call that planner can absorb
- **Intent config scattered across 4 files** — adding an intent requires 4 edits
- **~110 lines of dead code** (WORKFLOW_TEMPLATES, fillTemplateParams)
- **Evaluator uses conditional edges** — routing decision and state update are split

## Approach

**Single flat graph + NodeContext + Command routing.** Rewrite (not refactor) the agent module internals while keeping the external interface stable.

### External Interface (no changes)

- `AgentService.executeRun(taskId, runId, revisionInput, callbacks, signal, approvalMode): Promise<void>`
- `AgentService.resolveApproval(runId, approved): void`
- `AgentCallbacks` interface (12 methods)
- 21 `TASK_EVENTS` event types and payloads
- `ToolRegistry`, `SkillRegistry`, `WorkspaceService`, `EventPublisher` public APIs

---

## Graph Topology

```
START → planner ──→ executor → checker ──→ executor  (continue / retry)
           │          ↑                ──→ planner   (replan)
           │          │                ──→ finalizer → END  (complete)
           │          └────────────────── (retry back to executor)
           │                           ──→ END       (fail / cancelled)
           └──→ END  (guardrail block / validation failure / plan rejected)
```

4 nodes, no conditional edges. Both planner and checker use `Command({ update, goto })` for routing.

---

## State Schema (13 fields)

```typescript
AgentStateAnnotation = Annotation.Root({
  // Input (set at invoke, immutable during run)
  taskId:        Annotation<string>,
  runId:         Annotation<string>,
  userInput:     Annotation<string>,
  approvalMode:  Annotation<ApprovalMode>,

  // Plan
  plan:          Annotation<PlanDef | null>,
  stepIndex:     Annotation<number>,
  intent:        Annotation<TaskIntent>,

  // Execution accumulation (append reducer)
  stepResults:   Annotation<StepResult[]>({ reducer: append, default: [] }),

  // Executor → Checker communication
  lastStepRunId: Annotation<string>,   // stepRun DB id, checker needs it for updateStepRun
  lastOutput:    Annotation<string>,

  // Fault tolerance counters
  retryCount:    Annotation<number>,
  replanCount:   Annotation<number>,
  executionOrder: Annotation<number>,

  // Terminal signal
  error:         Annotation<string | null>,
});
```

Removed vs current: `shouldStop` (replaced by `error !== null`), `taskIntentSubType` (handled internally), `usedTokens`/`tokenBudget` (read from tokenTracker via NodeContext), `evaluation` (checker routes directly via Command).

---

## NodeContext (via config.configurable)

All runtime dependencies passed through `config.configurable.ctx`:

```typescript
interface NodeContext {
  // External dependencies (NestJS DI)
  llm:              ChatOpenAI;
  toolRegistry:     ToolRegistry;
  skillRegistry:    SkillRegistry;
  workspace:        WorkspaceService;
  callbacks:        AgentCallbacks;
  eventPublisher:   EventPublisher;
  subAgentRegistry: SubAgentRegistry;

  // Per-run runtime
  signal:           AbortSignal;
  tokenTracker:     TokenTrackerCallback;
  tokenBudgetGuard: TokenBudgetGuard;

  // Global config (shared across runs)
  soMethod:         'functionCalling' | 'json_schema' | 'jsonMode';
  maxRetries:       number;
  maxReplans:       number;
  maxSteps:         number;
  stepTimeoutMs:    number;
  skillTimeoutMs:   number;
  exportPdfEnabled: boolean;
  planValidationOptions: PlanSemanticValidationOptions;
}

function getCtx(config: RunnableConfig): NodeContext {
  return config.configurable!.ctx as NodeContext;
}
```

All node signatures become `(state: AgentState, config: RunnableConfig) => Promise<Partial<AgentState>>`.

---

## IntentConfig Registry

Centralizes all per-intent behavior in one file:

```typescript
interface IntentConfig {
  workflowBuilder?: (state: AgentState, ctx: NodeContext) => PlanStepDef[];
  deterministicCheck: boolean;
  useLastStepAsArtifact: boolean;
  plannerGuidance?: string;
}

const INTENT_CONFIGS: Record<TaskIntent, IntentConfig> = {
  code_generation:      { workflowBuilder: ..., deterministicCheck: true,  useLastStepAsArtifact: false },
  research_report:      { workflowBuilder: ..., deterministicCheck: true,  useLastStepAsArtifact: true  },
  competitive_analysis: { workflowBuilder: ..., deterministicCheck: true,  useLastStepAsArtifact: true  },
  content_writing:      {                       deterministicCheck: false, useLastStepAsArtifact: false, plannerGuidance: '...' },
  general:              {                       deterministicCheck: false, useLastStepAsArtifact: false },
};
```

Adding a new intent = one entry here. Planner, checker, finalizer all read from this map.

---

## Node Designs

### planner (merges router)

Internal flow:
1. If replan (`replanCount > 0`) → skip intent classification, keep existing `state.intent`, go to step 4
2. Intent classification — single LLM call with structured output `{ intent, steps[] }` (classification + planning combined in one call, saving the separate router LLM call)
3. Check `INTENT_CONFIGS[resolvedIntent].workflowBuilder`:
   - Has builder → use fixed plan from builder, ignore LLM-generated steps (zero extra LLM calls beyond the one in step 2)
   - No builder → use LLM-generated steps from step 2
4. Semantic validation on final steps (max 2 attempts, only for LLM-generated steps)
5. If `approvalMode === 'plan_first'` → `interrupt(planReviewInfo)`
6. `callbacks.savePlan()` + emit `PLAN_CREATED`

Output: `{ intent, plan, stepIndex: 0, retryCount: 0, lastOutput: '' }`

Note: For deterministic intents (code_generation, research_report, competitive_analysis), the LLM call in step 2 still happens (for classification), but the planning is instant (step 3 uses the fixed builder). This costs 1 LLM call total (same as current router). For non-deterministic intents (general, content_writing), it's also 1 LLM call total (vs current 2 calls: router + planner). Net saving: 1 LLM call per non-deterministic run.

**Classification failure fallback**: If the LLM returns an unrecognized intent or classification fails, default to `general`. This is safe because the general path handles any task type using the LLM-generated plan steps — it's just less optimized than a deterministic workflow.

**Error paths use Command routing** (not static edge):
- Guardrail block → `Command({ update: { error: 'guardrail_blocked:...' }, goto: END })`
- Validation failure (2 attempts exhausted) → `Command({ update: { error: '...' }, goto: END })`
- HITL plan rejected → `Command({ update: { error: 'plan_rejected' }, goto: END })`
- Normal path → `Command({ update: { intent, plan, ... }, goto: 'executor' })`

### executor (thin dispatcher ~80 lines)

Internal flow:
1. Read `plan.steps[stepIndex]`
2. HITL interrupt check (all_steps / side_effects mode)
3. `callbacks.createStepRun()` + emit `STEP_STARTED`
4. Dispatch by step type:
   - `step.subAgent` → `executors/subagent.executor.ts`
   - `step.skillName` → `executors/skill.executor.ts`
   - otherwise → `executors/tool.executor.ts`
5. Return `{ lastOutput, executionOrder: state.executionOrder + 1 }`
6. On error: return `{ lastOutput: errorMsg, executionOrder: +1 }`

### executors/ (3 focused files)

**tool.executor.ts (~150 lines):**
- Tool Calling: LLM resolves parameters from step context (when prior steps exist)
- No prior steps → use planner parameters directly
- Dynamic param tools (browse_url, write_file, etc.) fail-closed on resolution failure
- Static param tools fallback with placeholder detection
- `toolRegistry.executeWithCache()` + emit TOOL_CALLED/TOOL_COMPLETED
- `persistStepOutput()` to workspace

**skill.executor.ts (~100 lines):**
- Resolve `__STEP_RESULTS__` placeholder
- `skill.execute()` async iterator
- Forward tool_call/tool_result/progress/result events
- `persistStepOutput()`

**subagent.executor.ts (~120 lines):**
- Resolve `__STEP_RESULTS__` placeholder (shared `resolveStepResults()` utility)
- `createReactAgent(llm, tools, systemPrompt)`
- SubAgentEventBridge for tool event forwarding
- Extract last message content as output

### checker (Command routing ~200 lines)

Internal flow:
1. Cancel check → `callbacks.readCancelFlag()` → if yes: `Command({ update: { error: 'cancelled' }, goto: END })`
2. Token budget check → `tokenBudgetGuard.check()` → if exceeded: goto END
3. Rule-based pre-checks (same logic as current evaluator):
   - Empty/timeout → retry
   - Structural error → replan (skip retry)
   - Code execution failure → replan
   - Resource unavailable → retry with fallback tool
4. Deterministic workflow? (`INTENT_CONFIGS[intent].deterministicCheck`)
   - YES → last step? complete : continue (no LLM call)
   - NO → LLM evaluation (structured output: { decision, reason })
5. Apply decision via Command:
   - continue → `Command({ update: { stepIndex+1, retryCount:0, stepResults:[+new] }, goto: 'executor' })`
   - retry → `Command({ update: { retryCount+1 }, goto: 'executor' })`
   - replan → `Command({ update: { replanCount+1, retryCount:0, stepResults:[+new] }, goto: 'planner' })`
   - complete → `Command({ update: { stepResults:[+new] }, goto: 'finalizer' })`
   - fail → `Command({ update: { error: reason }, goto: END })`

Each branch: `updateStepRun` to terminal status + emit `STEP_COMPLETED`/`STEP_FAILED` + emit `EVALUATOR_DECIDED`

### finalizer (~150 lines)

Internal flow:
1. Token budget check
2. `INTENT_CONFIGS[intent].useLastStepAsArtifact`?
   - YES → use last step output as artifact body
   - NO → LLM generates artifact
3. Parse TYPE marker + normalizeArtifact
4. `callbacks.saveArtifact()` + emit `ARTIFACT_CREATED`
5. LLM generates JSON summary + saveArtifact
6. Optional PDF export
7. Write to LangGraph Store for cross-run memory

---

## agent.service.ts (~200 lines)

Lightweight NestJS service shell:

```
constructor:
  - Read config (model, timeouts, limits)
  - Create LLM instance
  - Set toolRegistry availability checker
  - Build NodeContext template (without per-run fields)
  - buildAgentGraph().compile({ checkpointer, store }) → save compiled graph

executeRun(taskId, runId, userInput, callbacks, signal, approvalMode):
  1. Create per-run NodeContext (add signal, tokenTracker, tokenBudgetGuard, callbacks)
  2. compiled.invoke(initialState, { configurable: { thread_id: runId, ctx } })
  3. HITL while loop (same logic as current, but simpler — just invoke/Command cycle)
  4. finally: save token stats, close browser sessions, finalize

resolveApproval(runId, approved):
  - Same as current (resolve promise in approvalMap)
```

---

## agent.graph.ts (~120 lines)

Graph definition, compiled once:

```typescript
import { StateGraph, START, END } from '@langchain/langgraph';

export function buildAgentGraph() {
  return new StateGraph(AgentStateAnnotation)
    .addNode('planner',   plannerNode,   { ends: ['executor', END] })
    .addNode('executor',  executorNode)
    .addNode('checker',   checkerNode,   { ends: ['executor', 'planner', 'finalizer', END] })
    .addNode('finalizer', finalizerNode)
    .addEdge(START, 'planner')
    // planner → executor is via Command (not static edge), so planner can also goto END on error
    .addEdge('executor', 'checker')
    .addEdge('finalizer', END);
}
```

Compiled in AgentService constructor with `checkpointer: MemorySaver()` and `store: InMemoryStore()`.

Note: `planner` and `checker` both use Command for routing. Static edges only for: `START → planner`, `executor → checker`, `finalizer → END`. The `END` constant from `@langchain/langgraph` is used everywhere (not the `'__end__'` string literal).

---

## File Inventory

| File | Lines | Responsibility |
|------|-------|----------------|
| `agent.state.ts` | ~65 | State definition (13 fields) |
| `agent.context.ts` | ~40 | NodeContext type + getCtx() |
| `agent.graph.ts` | ~120 | Graph definition + compile |
| `agent.service.ts` | ~200 | NestJS service shell |
| `agent.module.ts` | ~35 | Module registration |
| `agent.callbacks.ts` | 96 | Unchanged |
| `intent.config.ts` | ~80 | Intent configuration registry |
| `nodes/planner.node.ts` | ~250 | Merged router + planner |
| `nodes/executor.node.ts` | ~80 | Thin dispatcher |
| `nodes/checker.node.ts` | ~200 | Rules + LLM + Command routing |
| `nodes/finalizer.node.ts` | ~150 | Artifact generation |
| `executors/tool.executor.ts` | ~150 | Tool Calling + execution |
| `executors/skill.executor.ts` | ~100 | Skill iterator execution |
| `executors/subagent.executor.ts` | ~120 | createReactAgent execution |
| `plan-validator.ts` | ~150 | Semantic validation |
| `token-tracker.callback.ts` | 95 | Unchanged |
| `token-budget.guard.ts` | 31 | Unchanged |
| `guardrails/guardrail.chain.ts` | 35 | Unchanged |
| `guardrails/guardrail-blocked.error.ts` | 13 | Unchanged |
| **Total** | **~2,005** | **Current: ~3,200 (37% reduction)** |

## web_research Migration

The current `web_research` is a pseudo-skill: it has a `skillName` but bypasses `SkillRegistry` entirely, handled as a special case in the executor node wrapper (`agent.service.ts:287-342`) which builds a standalone subgraph (search → fetch → synthesize).

**Decision: Delete entirely.** The `researcher` SubAgent (createReactAgent with web_search + fetch_url_as_markdown + browse_url tools) fully covers this use case with more flexibility (the ReAct agent decides its own search strategy). The `research_report` and `competitive_analysis` deterministic workflows already use `subAgent: 'researcher'`, not `web_research`.

Cleanup required:
- Delete `nodes/research-subgraph.ts`
- Remove `web_research` from any planner prompt sections (if referenced as available skill)
- No SkillRegistry entry to remove (it was never registered there)

## Files to Delete

| File | Reason |
|------|--------|
| `nodes/router.node.ts` | Merged into planner |
| `nodes/research-subgraph.ts` | Deleted: researcher SubAgent covers web research |
| `workflow.registry.ts` | Replaced by intent.config.ts |
| `subagents/react-subagent.ts` | Refactored into executors/subagent.executor.ts |
| `subagents/subagent.registry.ts` | Simplified, SubAgent defs move to intent.config or module init |

## Key Design Decisions

1. **Compile once, invoke many** — graph built in constructor, not per-run
2. **NodeContext via config.configurable** — eliminates 12-parameter node functions
3. **Router merged into planner** — saves one LLM call per run
4. **Command routing in checker** — co-locates state update and navigation
5. **Executor is thin dispatcher** — delegates to 3 focused executor files
6. **IntentConfig registry** — single source of truth for per-intent behavior
7. **No dead code** — WORKFLOW_TEMPLATES, fillTemplateParams removed
8. **Shared resolveStepResults()** — eliminates duplicated placeholder logic
