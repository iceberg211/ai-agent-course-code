import { createRetrieveNode } from '@/agent/langgraph/nodes/query.nodes';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

describe('createRetrieveNode', () => {
  const chunk = {
    id: 'chunk-1',
    content: '乔峰是丐帮帮主。',
    source: 'kb.md',
    chunk_index: 0,
    category: null,
    similarity: 0.91,
  };
  const baseState = {
    conversationId: 'conv-1',
    personaId: 'persona-1',
    question: '你好',
    turnId: 'turn-1',
    strategy: 'simple',
    routeReason: '直接问题',
    subQuestions: [],
    nextSubIdx: 0,
    currentQuery: '',
    currentHop: 0,
    maxHops: 3,
    documents: [],
    topDocuments: [],
    webCitations: [],
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
    workflowBudgetMs: 60_000,
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
    profileId: 'balanced_chat',
    evaluateMode: 'llm',
    rerankMode: 'llm',
    useLongTermMemory: true,
    routeMode: 'llm',
    queryHistory: [],
  } as RagGraphState;

  it('needRetrieval=false 时不调用 persona stage1，并记录 skipped 历史', async () => {
    const retrievalPolicyResolver = {
      resolve: jest.fn().mockResolvedValue({
        currentQuery: '你好',
        rewrite: {
          originalQuery: '你好',
          rewrittenQuery: '你好',
          keywords: ['你好'],
          expandedQueries: [
            {
              index: 0,
              query: '你好',
              keywords: ['你好'],
              angle: 'original',
            },
          ],
          changed: false,
          reason: '寒暄问题',
        },
        retrievalQueries: [
          {
            index: 0,
            query: '你好',
            keywords: ['你好'],
            angle: 'original',
          },
        ],
        strategy: {
          needRetrieval: false,
          useVector: false,
          useKeyword: false,
          useGraph: false,
          useExactPhrase: false,
          useMultiQuery: false,
          allowWeb: false,
          reason: '寒暄问题，不需要查知识库',
        },
        profileId: 'balanced_chat',
        profile: { id: 'balanced_chat' },
      }),
    };
    const retrievalPort = {
      retrieve: jest.fn(),
    };
    const node = createRetrieveNode(
      retrievalPolicyResolver as never,
      retrievalPort as never,
    );

    const update = await node(baseState, {
      configurable: {
        workflowInput: {
          personaId: 'persona-1',
          signal: new AbortController().signal,
          onCitations: jest.fn(),
        },
      },
    } as never);

    expect(retrievalPolicyResolver.resolve).toHaveBeenCalledWith({
      question: '你好',
      history: [],
      routeStrategy: 'simple',
      profileId: 'balanced_chat',
      signal: expect.any(AbortSignal),
    });
    expect(
      retrievalPort.retrieve,
    ).not.toHaveBeenCalled();
    expect(update).toMatchObject({
      currentQuery: '你好',
      currentHop: 1,
      nextSubIdx: 1,
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

  it('会根据增强后的 query 调 persona stage1，并累计 documents 与 trace', async () => {
    const retrievalPolicyResolver = {
      resolve: jest.fn().mockResolvedValue({
        currentQuery: '乔峰是谁？',
        rewrite: {
          originalQuery: '乔峰是谁？',
          rewrittenQuery: '乔峰 身份',
          keywords: ['乔峰', '身份'],
          expandedQueries: [
            {
              index: 0,
              query: '乔峰是谁？',
              keywords: ['乔峰', '身份'],
              angle: 'original',
            },
            {
              index: 1,
              query: '乔峰 身份',
              keywords: ['乔峰', '身份'],
              angle: 'semantic',
            },
          ],
          changed: true,
          reason: '补全实体',
        },
        retrievalQueries: [
          {
            index: 0,
            query: '乔峰是谁？',
            keywords: ['乔峰', '身份'],
            angle: 'original',
          },
          {
            index: 1,
            query: '乔峰 身份',
            keywords: ['乔峰', '身份'],
            angle: 'semantic',
          },
        ],
        strategy: {
          needRetrieval: true,
          useVector: true,
          useKeyword: true,
          useGraph: false,
          useExactPhrase: false,
          useMultiQuery: true,
          allowWeb: true,
          reason: '复杂问题，使用多路 query 检索',
        },
        profileId: 'balanced_chat',
        profile: { id: 'balanced_chat' },
      }),
    };
    const retrievalPort = {
      retrieve: jest.fn().mockResolvedValue({
        knowledgeCount: 1,
        chunks: [chunk],
        trace: [
          {
            knowledgeId: 'kb-1',
            queryIndex: 0,
            query: '乔峰是谁？',
            keywords: ['乔峰', '身份'],
            angle: 'original',
            vectorBackend: 'pgvector',
            keywordBackend: 'pg',
            graphBackend: 'disabled',
            vectorResultCount: 1,
            keywordResultCount: 1,
            mergedResultCount: 1,
            fallbackToPg: false,
            skippedChannels: [],
          },
        ],
        rerankLimit: 8,
      }),
    };
    const onCitations = jest.fn();
    const node = createRetrieveNode(
      retrievalPolicyResolver as never,
      retrievalPort as never,
    );

    const update = await node(
      {
        ...baseState,
        question: '乔峰是谁？',
      },
      {
        configurable: {
          workflowInput: {
            conversationId: 'conv-1',
            personaId: 'persona-1',
            question: '乔峰是谁？',
            turnId: 'turn-1',
            signal: new AbortController().signal,
            onToken: jest.fn(),
            onCitations,
          },
        },
      } as never,
    );

    expect(retrievalPort.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        personaId: 'persona-1',
        retrievalQueries: [
          {
            index: 0,
            query: '乔峰是谁？',
            keywords: ['乔峰', '身份'],
            angle: 'original',
          },
          {
            index: 1,
            query: '乔峰 身份',
            keywords: ['乔峰', '身份'],
            angle: 'semantic',
          },
        ],
        strategy: expect.objectContaining({
          needRetrieval: true,
          useVector: true,
          useKeyword: true,
          useGraph: false,
          allowWeb: true,
        }),
        graphExpand: false,
        question: '乔峰是谁？',
        currentQuery: '乔峰是谁？',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(update).toMatchObject({
      currentQuery: '乔峰是谁？',
      currentHop: 1,
      nextSubIdx: 1,
      documents: [chunk],
      retrievalTrace: [
        expect.objectContaining({
          knowledgeId: 'kb-1',
        }),
      ],
      retrievalHistory: [
        {
          query: '乔峰是谁？',
          resultCount: 1,
        },
      ],
      stopReason: '',
      rerankLimit: 8,
    });
    // 粗召回阶段不再推 citations
    expect(onCitations).not.toHaveBeenCalled();
  });

  it('关系类问题会把 graphMode 和 graphMaxHops 沿 Agent 主链路传给 persona stage1', async () => {
    const retrievalPolicyResolver = {
      resolve: jest.fn().mockResolvedValue({
        currentQuery: '甲方和乙方是什么关系？',
        rewrite: {
          originalQuery: '甲方和乙方是什么关系？',
          rewrittenQuery: '甲方 乙方 关系',
          keywords: ['甲方', '乙方', '关系'],
          expandedQueries: [
            {
              index: 0,
              query: '甲方和乙方是什么关系？',
              keywords: ['甲方', '乙方', '关系'],
              angle: 'original',
            },
          ],
          changed: true,
          reason: '抽出关系实体',
        },
        retrievalQueries: [
          {
            index: 0,
            query: '甲方和乙方是什么关系？',
            keywords: ['甲方', '乙方', '关系'],
            angle: 'original',
          },
        ],
        strategy: {
          needRetrieval: true,
          useVector: true,
          useKeyword: true,
          useGraph: true,
          useExactPhrase: false,
          useMultiQuery: false,
          allowWeb: true,
          graphMode: 'path',
          graphMaxHops: 2,
          reason: '关系类问题，启用 Neo4j 路径检索',
        },
        profileId: 'balanced_chat',
        profile: { id: 'balanced_chat' },
      }),
    };
    const retrievalPort = {
      retrieve: jest.fn().mockResolvedValue({
        knowledgeCount: 1,
        chunks: [chunk],
        trace: [],
      }),
    };
    const node = createRetrieveNode(
      retrievalPolicyResolver as never,
      retrievalPort as never,
    );

    await node(
      {
        ...baseState,
        question: '甲方和乙方是什么关系？',
      },
      {
        configurable: {
          workflowInput: {
            conversationId: 'conv-1',
            personaId: 'persona-1',
            question: '甲方和乙方是什么关系？',
            turnId: 'turn-1',
            signal: new AbortController().signal,
            onToken: jest.fn(),
            onCitations: jest.fn(),
          },
        },
      } as never,
    );

    expect(
      retrievalPort.retrieve,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: expect.objectContaining({
          useGraph: true,
          graphMode: 'path',
          graphMaxHops: 2,
        }),
      }),
    );
  });
});
