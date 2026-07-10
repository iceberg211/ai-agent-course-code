import type { RagWorkflowState } from '@/agent/types/rag-workflow.types';
import { AgentService } from '@/agent/agent.service';

describe('AgentService', () => {
  it('会把请求转发给 orchestrator，并返回完整 RAG 结果', async () => {
    const ragResult = {
      state: {
        conversationId: 'conv-1',
        personaId: 'persona-1',
        question: '你好',
        turnId: 'turn-1',
        strategy: 'simple',
        routeReason: '直接问题',
        subQuestions: [],
        nextSubIdx: 1,
        currentQuery: '你好',
        currentHop: 1,
        maxHops: 3,
        documents: [],
        topDocuments: [],
        evidenceChunks: [],
        localCitations: [],
        webCitations: [],
        citations: [],
        retrievalHistory: [],
        retrievalTrace: [],
        graphReasoningTrace: [],
        shortTermMemory: { window: [], summary: '', activeContext: '' },
        longTermMemories: [],
        memoryContext: '',
        retrievalStrategy: {
          name: 'balanced',
          needRetrieval: false,
          useVector: false,
          useKeyword: false,
          useGraph: false,
          useExactPhrase: false,
          useMultiQuery: false,
          allowWeb: false,
          reason: '寒暄问题，不需要查知识库',
          useMemory: false,
          useMultimodal: false,
          vectorTopK: 10,
          keywordTopK: 10,
          graphTopK: 5,
          memoryTopK: 3,
          rrfK: 60,
          rerankTopK: 5,
          minRerankScore: 3,
        },
        retrievalStrategyReason: '寒暄问题，不需要查知识库',
        routeAllowWeb: false,
        workflowStartedAt: Date.now(),
        workflowBudgetMs: 20_000,
        profileId: 'balanced_chat',
        useGraphExpand: false,
        evaluateMode: 'heuristic',
        rerankMode: 'score',
        useLongTermMemory: true,
        routeMode: 'llm',
        enough: true,
        missingFacts: [],
        evaluationReason: '证据足够',
        webQuery: '',
        webSearchAttempted: false,
        webSearchUsed: false,
        webSearchAttempts: 0,
        maxWebSearchAttempts: 2,
        webSearchQueries: [],
        stopReason: 'single_hop_enough',
        orchestrator: 'langgraph',
        rerankLimit: 5,
      } satisfies RagWorkflowState,
      citations: [],
      answerText: '你好',
    };
    const orchestrator = {
      run: jest.fn().mockResolvedValue(ragResult),
    };

    const service = new AgentService(orchestrator as never);
    const onToken = jest.fn();
    const onCitations = jest.fn();

    const result = await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      userMessage: '你好',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken,
      onCitations,
    });

    expect(orchestrator.run).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        personaId: 'persona-1',
        question: '你好',
        turnId: 'turn-1',
        onToken,
        onCitations,
      }),
    );
    expect(result).toBe(ragResult);
  });
});
