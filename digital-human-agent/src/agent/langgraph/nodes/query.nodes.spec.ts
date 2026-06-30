import { createRetrieveNode, createGraphReasoningNode } from '@/agent/langgraph/nodes/query.nodes';
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
    evidenceChunks: [],
    webCitations: [],
    retrievalHistory: [],
    retrievalTrace: [],
    graphReasoningTrace: [],
    plannedNext: '',
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
    rerankLimit: 5,
    answerText: '',
    persona: null,
    history: [],
  } satisfies RagGraphState;

  it('needRetrieval=false 时不调用 persona stage1，并记录 skipped 历史', async () => {
    const queryAugmentationService = {
      plan: jest.fn().mockResolvedValue({
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
      }),
    };
    const personaStage1RetrievalService = {
      retrieveForPersona: jest.fn(),
    };
    const node = createRetrieveNode(
      queryAugmentationService as never,
      personaStage1RetrievalService as never,
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

    expect(queryAugmentationService.plan).toHaveBeenCalledWith({
      question: '你好',
      history: [],
      routeStrategy: 'simple',
      signal: expect.any(AbortSignal),
    });
    expect(
      personaStage1RetrievalService.retrieveForPersona,
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
    const queryAugmentationService = {
      plan: jest.fn().mockResolvedValue({
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
      }),
    };
    const personaStage1RetrievalService = {
      retrieveForPersona: jest.fn().mockResolvedValue({
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
      queryAugmentationService as never,
      personaStage1RetrievalService as never,
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

    expect(
      personaStage1RetrievalService.retrieveForPersona,
    ).toHaveBeenCalledWith({
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
      signal: expect.any(AbortSignal),
    });
    expect(update).toMatchObject({
      currentQuery: '乔峰是谁？',
      currentHop: 1,
      nextSubIdx: 1,
      documents: [chunk],
      evidenceChunks: [chunk],
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
    expect(onCitations).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: 'knowledge',
        id: 'chunk-1',
      }),
    ]);
  });

  it('关系类问题会把 graphMode 和 graphMaxHops 沿 Agent 主链路传给 persona stage1', async () => {
    const queryAugmentationService = {
      plan: jest.fn().mockResolvedValue({
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
      }),
    };
    const personaStage1RetrievalService = {
      retrieveForPersona: jest.fn().mockResolvedValue({
        knowledgeCount: 1,
        chunks: [chunk],
        trace: [],
      }),
    };
    const node = createRetrieveNode(
      queryAugmentationService as never,
      personaStage1RetrievalService as never,
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
      personaStage1RetrievalService.retrieveForPersona,
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

describe('createGraphReasoningNode', () => {
  const baseState = {
    conversationId: 'conv-1',
    question: '乔峰和慕容复是什么关系',
    documents: [
      {
        id: 'chunk-1',
        content: '乔峰是契丹人。',
        source: 'test.md',
        knowledge_base_id: 'kb-1',
        chunk_index: 0,
        category: null,
      },
    ],
    evidenceChunks: [],
    graphReasoningTrace: [],
    retrievalStrategy: {
      useGraph: true,
    },
    shortTermMemory: { window: [], summary: '', activeContext: '' },
    longTermMemories: [],
    webCitations: [],
  } as any;

  it('strategy.useGraph = false 时不进行图推理，直接返回空对象', async () => {
    const graphService = {
      isEnabled: () => true,
    } as any;

    const node = createGraphReasoningNode(graphService);
    const result = await node(
      {
        ...baseState,
        retrievalStrategy: { useGraph: false },
      },
      {
        configurable: {
          workflowInput: { signal: new AbortController().signal },
        },
      } as any,
    );

    expect(result).toEqual({});
  });

  it('strategy.useGraph = true 时，提取实体进行图推理扩展并合并结果', async () => {
    const graphService = {
      isEnabled: () => true,
      listEntities: jest.fn().mockResolvedValue([
        { key: 'Topic::乔峰', name: '乔峰' },
      ]),
      getNeighborhood: jest.fn().mockResolvedValue([
        {
          id: 'chunk-2',
          document_id: 'doc-1',
          knowledge_base_id: 'kb-1',
          content: '乔峰与慕容复齐名。',
          source: 'test.md',
          chunk_index: 1,
          category: 'text',
          confidence: 0.9,
          evidenceText: '乔峰与慕容复齐名。',
        },
      ]),
    } as any;

    const node = createGraphReasoningNode(graphService);
    const accessScope = {
      ownerId: 'user-1',
      department: '研发部',
      role: 'user',
    };
    const result = await node(
      baseState,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
            onCitations: jest.fn(),
            accessScope,
          },
        },
      } as any,
    );

    expect(graphService.listEntities).toHaveBeenCalledWith('kb-1', '', 50, accessScope);
    expect(graphService.getNeighborhood).toHaveBeenCalledWith('kb-1', 'Topic::乔峰', accessScope);
    expect(result.documents).toHaveLength(2);
    expect(result.graphReasoningTrace).toEqual([
      {
        knowledgeId: 'kb-1',
        matchedEntities: [{ key: 'Topic::乔峰', name: '乔峰' }],
        expandedChunkIds: ['chunk-2'],
        expandedChunkCount: 1,
        skipped: false,
        reason: undefined,
      },
    ]);
    
    const contents = result.documents.map((d: any) => d.content);
    expect(contents).toContain('乔峰与慕容复齐名。');
    expect(contents).toContain('乔峰是契丹人。');
  });
});
