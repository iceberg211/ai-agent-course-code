import { createRetrievalStrategyNode } from '@/agent/langgraph/nodes/retrieval-strategy.node';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

describe('createRetrievalStrategyNode', () => {
  const baseState = {
    conversationId: 'conv-1',
    personaId: 'persona-1',
    question: '你好',
    turnId: 'turn-1',
    strategy: 'simple',
    routeReason: '直接问题',
    subQuestions: [],
    currentHop: 0,
    maxHops: 3,
    evidenceChunks: [],
    webCitations: [],
    retrievalHistory: [],
    enough: null,
    missingFacts: [],
    evaluationReason: '',
    webQuery: '',
    webSearchAttempted: false,
    webSearchUsed: false,
    stopReason: '',
    orchestrator: 'langgraph',
    answerText: '',
    persona: null,
    history: [],
  } satisfies RagGraphState;

  it('needRetrieval=false 时跳过检索并写入 skipped 历史', async () => {
    const retrievalStrategyService = {
      plan: jest.fn().mockResolvedValue({
        needRetrieval: false,
        useVector: false,
        useKeyword: false,
        useGraph: false,
        useExactPhrase: false,
        useMultiQuery: false,
        useHyDE: false,
        allowWeb: false,
        reason: '寒暄问题，不需要查知识库',
      }),
    };
    const node = createRetrievalStrategyNode(retrievalStrategyService as never);

    const command = await node(baseState, {
      configurable: {
        workflowInput: {
          signal: new AbortController().signal,
        },
      },
    } as never);

    expect(command.goto).toEqual(['load_context']);
    expect(command.update).toMatchObject({
      retrievalStrategy: expect.objectContaining({
        needRetrieval: false,
      }),
      retrievalHistory: [
        expect.objectContaining({
          query: '你好',
          resultCount: 0,
          skipped: true,
          reason: '寒暄问题，不需要查知识库',
        }),
      ],
    });
  });

  it('需要检索时进入 prepare_query 并保留策略', async () => {
    const strategy = {
      needRetrieval: true,
      useVector: true,
      useKeyword: true,
      useGraph: false,
      useExactPhrase: true,
      useMultiQuery: true,
      useHyDE: false,
      allowWeb: true,
      reason: '需要知识库事实',
    };
    const retrievalStrategyService = {
      plan: jest.fn().mockResolvedValue(strategy),
    };
    const node = createRetrievalStrategyNode(retrievalStrategyService as never);

    const command = await node(baseState, {
      configurable: {
        workflowInput: {
          signal: new AbortController().signal,
        },
      },
    } as never);

    expect(command.goto).toEqual(['prepare_query']);
    expect(command.update).toMatchObject({
      retrievalStrategy: strategy,
      retrievalStrategyReason: '需要知识库事实',
    });
  });
});
