import { toRagWorkflowState } from '@/agent/langgraph/rag.state';

describe('toRagWorkflowState', () => {
  it('会从原始证据和检索历史推导派生字段，而不是直接信任 state 中的缓存值', () => {
    const chunk = {
      id: 'chunk-1',
      content: '乔峰是丐帮帮主。',
      source: 'chunk-1.md',
      chunk_index: 0,
      category: null,
      similarity: 0.9,
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
      currentHop: 1,
      maxHops: 3,
      evidenceChunks: [chunk],
      webCitations: [webCitation],
      retrievalHistory: [{ query: '乔峰是谁？', resultCount: 1 }],
      enough: true,
      missingFacts: [],
      evaluationReason: '证据足够',
      webQuery: '',
      webSearchAttempted: true,
      webSearchUsed: true,
      stopReason: 'web_fallback_enough',
      orchestrator: 'langgraph',
      answerText: '答案',
      persona: null,
      history: [],
    });

    expect(workflowState.currentQuery).toBe('乔峰是谁？');
    expect(workflowState.localCitations).toEqual([
      {
        kind: 'knowledge',
        ...chunk,
      },
    ]);
    expect(workflowState.citations).toEqual([
      {
        kind: 'knowledge',
        ...chunk,
      },
      webCitation,
    ]);
  });
});
