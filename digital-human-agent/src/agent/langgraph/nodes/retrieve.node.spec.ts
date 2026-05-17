import { createRetrieveEvidenceNode } from '@/agent/langgraph/nodes/retrieve.node';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

describe('createRetrieveEvidenceNode', () => {
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
    retrievalStrategy: {
      needRetrieval: false,
      useVector: false,
      useKeyword: false,
      useGraph: false,
      useExactPhrase: false,
      useMultiQuery: false,
      allowWeb: false,
      reason: '寒暄问题，不需要查知识库',
    },
    retrievalStrategyReason: '寒暄问题，不需要查知识库',
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
    answerText: '',
    persona: null,
    history: [],
  } satisfies RagGraphState;

  it('needRetrieval=false 时不调用 KnowledgeSearchService，并记录 skipped 历史', async () => {
    const knowledgeSearchService = {
      retrieveForPersona: jest.fn(),
    };
    const node = createRetrieveEvidenceNode(knowledgeSearchService as never);

    const update = await node(baseState, {
      configurable: {
        workflowInput: {
          personaId: 'persona-1',
          signal: new AbortController().signal,
          onCitations: jest.fn(),
        },
      },
    } as never);

    expect(knowledgeSearchService.retrieveForPersona).not.toHaveBeenCalled();
    expect(update).toMatchObject({
      retrievalHistory: [
        {
          query: '你好',
          resultCount: 0,
          skipped: true,
          reason: '寒暄问题，不需要查知识库',
        },
      ],
      stopReason: 'retrieval_skipped',
    });
  });
});
