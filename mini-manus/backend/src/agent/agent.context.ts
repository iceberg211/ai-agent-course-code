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

export interface PlanSemanticValidationOptions {
  maxSteps?: number;
  allowedSideEffectTools?: string[];
  allowedSideEffectSkills?: string[];
}

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
