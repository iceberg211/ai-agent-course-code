import { toRagWorkflowState } from '@/agent/langgraph/rag.state';

describe('toRagWorkflowState', () => {
  it('会优先把 rerank 后的 topDocuments 作为最终本地证据与引用', () => {
    const stage1Chunk = {
      id: 'chunk-1',
      content: '乔峰是丐帮帮主。',
      source: 'chunk-1.md',
      chunk_index: 0,
      category: null,
      similarity: 0.9,
    };
    const topChunk = {
      id: 'chunk-2',
      content: '乔峰原名萧峰。',
      source: 'chunk-2.md',
      chunk_index: 1,
      category: null,
      similarity: 0.95,
      rerank_score: 0.98,
    };
    const webCitation = {
      kind: 'web' as const,
      title: '乔峰资料',
      url: 'https://example.com/qiaofeng',
      snippet: '网页摘要',
      siteName: '示例站点',
      publishedAt: '2026-04-21',
    };

    const workflowState = toRagWorkflowState({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '乔峰是谁？',
      turnId: 'turn-1',
      strategy: 'simple',
      routeReason: '直接问题',
      subQuestions: [],
      nextSubIdx: 1,
      currentQuery: '',
      currentHop: 1,
      maxHops: 3,
      documents: [stage1Chunk, topChunk],
      topDocuments: [topChunk],
      evidenceChunks: [stage1Chunk],
      webCitations: [webCitation],
      retrievalHistory: [{ query: '乔峰是谁？', resultCount: 1 }],
      retrievalTrace: [],
      graphReasoningTrace: [],
      shortTermMemory: { window: [], summary: '', activeContext: '' },
      longTermMemories: [],
      memoryContext: '',
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
      routeAllowWeb: true,
      workflowStartedAt: Date.now(),
      workflowBudgetMs: 20_000,
      profileId: 'balanced_chat',
      useGraphExpand: true,
      evaluateMode: 'llm',
      rerankMode: 'llm',
      enough: true,
      missingFacts: [],
      evaluationReason: '证据足够',
      webQuery: '',
      webSearchAttempted: true,
      webSearchUsed: true,
      webSearchAttempts: 1,
      maxWebSearchAttempts: 2,
      webSearchQueries: ['乔峰资料'],
      stopReason: 'web_fallback_enough',
      orchestrator: 'langgraph',
      rerankLimit: 5,
      answerText: '答案',
      persona: null,
      history: [],
    });

    expect(workflowState.currentQuery).toBe('乔峰是谁？');
    expect(workflowState.localCitations).toEqual([
      {
        kind: 'knowledge',
        ...topChunk,
      },
    ]);
    expect(workflowState.evidenceChunks).toEqual([topChunk]);
    expect(workflowState.citations).toEqual([
      {
        kind: 'knowledge',
        ...topChunk,
      },
      webCitation,
    ]);
  });
});
