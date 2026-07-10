export type RagProfileId =
  | 'realtime_voice'
  | 'balanced_chat'
  | 'deep_research'
  | 'search_debug';

export type RagRewriteMode = 'off' | 'heuristic' | 'llm';
export type RagRerankMode = 'off' | 'score' | 'llm' | 'dedicated';
export type RagEvaluateMode = 'off' | 'heuristic' | 'llm';
export type RagRouteMode = 'heuristic' | 'llm';

export interface RagProfileBudget {
  wallClockMs: number;
  maxLlmCalls: number;
  maxEmbedCalls: number;
}

export interface RagProfile {
  id: RagProfileId;
  maxHops: number;
  allowWeb: boolean;
  useMultiQuery: boolean;
  useGraphChannel: boolean;
  useGraphExpand: boolean;
  /** 是否加载并注入长期记忆（不进 rewrite/retrieve query） */
  useLongTermMemory: boolean;
  /** 路由：heuristic 不打 LLM（realtime 默认） */
  routeMode: RagRouteMode;
  rewriteMode: RagRewriteMode;
  rerankMode: RagRerankMode;
  evaluateMode: RagEvaluateMode;
  budget: RagProfileBudget;
}

export const RAG_PROFILES: Record<RagProfileId, RagProfile> = {
  realtime_voice: {
    id: 'realtime_voice',
    maxHops: 1,
    allowWeb: false,
    useMultiQuery: false,
    useGraphChannel: false,
    useGraphExpand: false,
    useLongTermMemory: false,
    routeMode: 'heuristic',
    rewriteMode: 'heuristic',
    rerankMode: 'score',
    evaluateMode: 'heuristic',
    budget: {
      wallClockMs: 8_000,
      maxLlmCalls: 2,
      maxEmbedCalls: 2,
    },
  },
  balanced_chat: {
    id: 'balanced_chat',
    maxHops: 3,
    allowWeb: true,
    useMultiQuery: true,
    useGraphChannel: true,
    useGraphExpand: true,
    useLongTermMemory: true,
    routeMode: 'llm',
    rewriteMode: 'llm',
    rerankMode: 'llm',
    evaluateMode: 'llm',
    budget: {
      wallClockMs: 20_000,
      maxLlmCalls: 5,
      maxEmbedCalls: 6,
    },
  },
  deep_research: {
    id: 'deep_research',
    maxHops: 4,
    allowWeb: true,
    useMultiQuery: true,
    useGraphChannel: true,
    useGraphExpand: true,
    useLongTermMemory: true,
    routeMode: 'llm',
    rewriteMode: 'llm',
    rerankMode: 'llm',
    evaluateMode: 'llm',
    budget: {
      wallClockMs: 45_000,
      maxLlmCalls: 10,
      maxEmbedCalls: 12,
    },
  },
  search_debug: {
    id: 'search_debug',
    maxHops: 2,
    allowWeb: false,
    useMultiQuery: true,
    useGraphChannel: true,
    useGraphExpand: true,
    useLongTermMemory: false,
    routeMode: 'llm',
    rewriteMode: 'llm',
    rerankMode: 'llm',
    evaluateMode: 'heuristic',
    budget: {
      wallClockMs: 30_000,
      maxLlmCalls: 4,
      maxEmbedCalls: 6,
    },
  },
};

export function getRagProfile(id?: string | null): RagProfile {
  const key = String(id ?? '')
    .trim()
    .toLowerCase() as RagProfileId;
  if (key && key in RAG_PROFILES) {
    return RAG_PROFILES[key];
  }
  return RAG_PROFILES.balanced_chat;
}

/** HTTP 文本对话默认 */
export function resolveHttpChatProfileId(): RagProfileId {
  return 'balanced_chat';
}

/** WS 会话 mode → profile */
export function resolveRealtimeProfileId(
  mode?: string | null,
): RagProfileId {
  if (mode === 'digital-human' || mode === 'voice') {
    return 'realtime_voice';
  }
  return 'balanced_chat';
}
