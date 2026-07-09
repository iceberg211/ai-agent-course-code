import type {
  RagCitation,
  RagWorkflowResult,
} from '@/agent/types/rag-workflow.types';
import type { RagProfileId } from '@/common/rag/rag-profile';
import type { TurnBudgetContext } from '@/common/rag/turn-budget.context';

export interface RagTurnReportMetrics {
  hops: number;
  llmCalls: number;
  embedCalls: number;
  latencyMs: number;
  firstTokenLatencyMs: number | null;
  citationCount: number;
}

export interface RagTurnReport {
  profileId: RagProfileId;
  strategy: 'simple' | 'complex' | 'none';
  stopReason: string;
  citations: RagCitation[];
  degradationFlags: string[];
  metrics: RagTurnReportMetrics;
  debug?: {
    routeReason?: string;
    retrievalStrategyReason?: string;
    subQuestions?: string[];
    retrievalHistory?: unknown;
    retrievalTrace?: unknown;
    graphReasoningTrace?: unknown;
    enough?: boolean | null;
    missingFacts?: string[];
    evaluationReason?: string;
    webSearchUsed?: boolean;
    webSearchQueries?: string[];
    orchestrator?: string;
    memory?: unknown;
  };
}

export function buildRagTurnReport(input: {
  result: RagWorkflowResult;
  profileId: RagProfileId;
  budget?: TurnBudgetContext | null;
  latencyMs: number;
  includeDebug?: boolean;
}): RagTurnReport {
  const { result, profileId, budget, latencyMs, includeDebug = true } = input;
  const state = result.state;
  const snapshot = result.budgetSnapshot;

  const report: RagTurnReport = {
    profileId,
    strategy: state.strategy,
    stopReason: state.stopReason || '',
    citations: result.citations,
    degradationFlags:
      budget?.snapshotFlags() ?? snapshot?.degradationFlags ?? [],
    metrics: {
      hops: state.currentHop ?? 0,
      llmCalls: budget?.llmCalls ?? snapshot?.llmCalls ?? 0,
      embedCalls: budget?.embedCalls ?? snapshot?.embedCalls ?? 0,
      latencyMs,
      firstTokenLatencyMs:
        budget?.firstTokenLatencyMs ?? snapshot?.firstTokenLatencyMs ?? null,
      citationCount: result.citations.length,
    },
  };

  if (includeDebug) {
    report.debug = {
      routeReason: state.routeReason,
      retrievalStrategyReason: state.retrievalStrategyReason,
      subQuestions: state.subQuestions,
      retrievalHistory: state.retrievalHistory,
      retrievalTrace: state.retrievalTrace,
      graphReasoningTrace: state.graphReasoningTrace,
      enough: state.enough,
      missingFacts: state.missingFacts,
      evaluationReason: state.evaluationReason,
      webSearchUsed: state.webSearchUsed,
      webSearchQueries: state.webSearchQueries,
      orchestrator: state.orchestrator,
      memory: {
        shortTermWindowCount: state.shortTermMemory?.window?.length ?? 0,
        hasShortTermSummary: Boolean(state.shortTermMemory?.summary),
        longTermMemoryCount: state.longTermMemories?.length ?? 0,
      },
    };
  }

  return report;
}

/**
 * 双写：legacy 字段 + report，兼容 Dashboard / 旧前端。
 */
export function toRagTracePayload(
  result: RagWorkflowResult,
  options: {
    profileId: RagProfileId;
    budget?: TurnBudgetContext | null;
    latencyMs: number;
  },
): Record<string, unknown> {
  const report = buildRagTurnReport({
    result,
    profileId: options.profileId,
    budget: options.budget,
    latencyMs: options.latencyMs,
    includeDebug: true,
  });
  const state = result.state;

  return {
    // legacy flat fields
    strategy: state.strategy,
    routeReason: state.routeReason,
    retrievalStrategy: state.retrievalStrategy,
    retrievalStrategyReason: state.retrievalStrategyReason,
    subQuestions: state.subQuestions,
    retrievalHistory: state.retrievalHistory,
    retrievalTrace: state.retrievalTrace,
    graphReasoningTrace: state.graphReasoningTrace,
    enough: state.enough,
    missingFacts: state.missingFacts,
    evaluationReason: state.evaluationReason,
    webSearchUsed: state.webSearchUsed,
    webSearchQueries: state.webSearchQueries,
    stopReason: state.stopReason,
    orchestrator: state.orchestrator,
    profileId: report.profileId,
    degradationFlags: report.degradationFlags,
    metrics: report.metrics,
    memory: report.debug?.memory,
    // 新契约
    report,
  };
}
