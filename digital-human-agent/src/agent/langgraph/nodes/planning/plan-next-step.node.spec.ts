import { createPlanNextStepNode } from '@/agent/langgraph/nodes/planning/plan-next-step.node';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

describe('createPlanNextStepNode', () => {
  const baseState = {
    conversationId: 'conv-1',
    personaId: 'persona-1',
    question: '复杂问题',
    turnId: 'turn-1',
    strategy: 'complex',
    routeReason: '需要多跳检索',
    subQuestions: ['第一问', '第二问'],
    nextSubIdx: 1,
    currentQuery: '第一问',
    currentHop: 1,
    maxHops: 3,
    documents: [],
    topDocuments: [],
    evidenceChunks: [],
    webCitations: [],
    retrievalHistory: [],
    retrievalTrace: [],
    plannedNext: '',
    retrievalStrategy: {
      needRetrieval: true,
      useVector: true,
      useKeyword: true,
      useGraph: false,
      useExactPhrase: false,
      useMultiQuery: true,
      allowWeb: true,
      reason: '测试策略',
    },
    retrievalStrategyReason: '测试策略',
    enough: null,
    missingFacts: [],
    evaluationReason: '',
    webQuery: '',
    webSearchAttempted: false,
    webSearchUsed: false,
    webSearchAttempts: 0,
    maxWebSearchAttempts: 2,
    webSearchQueries: [],
    stopReason: '',
    orchestrator: 'langgraph',
    rerankLimit: 5,
    answerText: '',
    persona: null,
    history: [],
  } satisfies RagGraphState;

  it('complex 还有剩余子问题时继续 retrieve', async () => {
    const node = createPlanNextStepNode();

    const command = await node(baseState);

    expect(command.goto).toEqual(['retrieve']);
    expect(command.update).toEqual({
      plannedNext: 'retrieve',
    });
  });

  it('simple 或子问题耗尽时进入 rerank', async () => {
    const node = createPlanNextStepNode();

    const command = await node({
      ...baseState,
      strategy: 'simple',
      subQuestions: [],
      nextSubIdx: 1,
      currentHop: 1,
    });

    expect(command.goto).toEqual(['rerank']);
    expect(command.update).toEqual({
      plannedNext: 'rerank',
    });
  });
});
