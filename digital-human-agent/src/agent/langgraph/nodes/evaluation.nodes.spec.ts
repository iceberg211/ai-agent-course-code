import {
  createRerankNode,
  createEvaluateEvidenceNode,
} from '@/agent/langgraph/nodes/evaluation.nodes';
import type { RagGraphState } from '@/agent/langgraph/rag.state';

describe('createRerankNode', () => {
  const documents = [
    {
      id: 'chunk-1',
      content: '第一段',
      source: 'demo.md',
      chunk_index: 0,
      category: null,
      similarity: 0.82,
    },
    {
      id: 'chunk-2',
      content: '第二段',
      source: 'demo.md',
      chunk_index: 1,
      category: null,
      similarity: 0.91,
    },
  ];

  it('会对累计 documents 做统一 rerank，并产出 topDocuments', async () => {
    const rerankerService = {
      rerank: jest.fn().mockResolvedValue([documents[1], documents[0]]),
    };
    const node = createRerankNode(rerankerService as never);

    const update = await node(
      {
        question: '当前问题',
        documents,
      } as never,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(rerankerService.rerank).toHaveBeenCalledWith(
      '当前问题',
      documents,
      5,
      expect.any(AbortSignal),
      undefined,
      'llm',
    );
    expect(update).toEqual({
      topDocuments: [documents[1], documents[0]],
      evidenceChunks: [documents[1], documents[0]],
    });
  });

  it('多跳时会用原始问题 + 当前 hop 查询句做 rerank', async () => {
    const rerankerService = {
      rerank: jest.fn().mockResolvedValue([documents[0]]),
    };
    const node = createRerankNode(rerankerService as never);

    await node(
      {
        question: '合同删除与审计要求是什么？',
        currentQuery: '审计要求是什么？',
        currentHop: 2,
        documents,
      } as never,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(rerankerService.rerank).toHaveBeenCalledWith(
      '合同删除与审计要求是什么？\n当前检索焦点：审计要求是什么？',
      documents,
      5,
      expect.any(AbortSignal),
      undefined,
      'llm',
    );
  });

  it('没有 documents 时不会调用 reranker', async () => {
    const rerankerService = {
      rerank: jest.fn(),
    };
    const node = createRerankNode(rerankerService as never);

    const update = await node(
      {
        question: '当前问题',
        documents: [],
      } as never,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(rerankerService.rerank).not.toHaveBeenCalled();
    expect(update).toEqual({
      topDocuments: [],
      evidenceChunks: [],
    });
  });

  it('如果 state 中有动态配置的 rerankLimit，则会优先使用它', async () => {
    const rerankerService = {
      rerank: jest.fn().mockResolvedValue([documents[1]]),
    };
    const node = createRerankNode(rerankerService as never);

    const update = await node(
      {
        question: '当前问题',
        documents,
        rerankLimit: 10,
      } as never,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(rerankerService.rerank).toHaveBeenCalledWith(
      '当前问题',
      documents,
      10,
      expect.any(AbortSignal),
      undefined,
      'llm',
    );
    expect(update).toEqual({
      topDocuments: [documents[1]],
      evidenceChunks: [documents[1]],
    });
  });

  it('检索策略中的 rerankTopK 与最低分应和 Search 链路保持一致', async () => {
    const rerankerService = {
      rerank: jest.fn().mockResolvedValue([documents[0]]),
    };
    const node = createRerankNode(rerankerService as never);

    await node(
      {
        question: '当前问题',
        documents,
        rerankLimit: 10,
        retrievalStrategy: {
          rerankTopK: 7,
          minRerankScore: 3.5,
        },
      } as never,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(rerankerService.rerank).toHaveBeenCalledWith(
      '当前问题',
      documents,
      7,
      expect.any(AbortSignal),
      3.5,
      'llm',
    );
  });
});

describe('createEvaluateEvidenceNode', () => {
  const baseState = {
    conversationId: 'conv-1',
    personaId: 'persona-1',
    question: '合同删除条款和审计要求是什么？',
    turnId: 'turn-1',
    strategy: 'complex',
    routeReason: '需要多跳检索',
    subQuestions: ['合同删除条款是什么？', '审计要求是什么？'],
    nextSubIdx: 2,
    currentQuery: '审计要求是什么？',
    currentHop: 1,
    maxHops: 3,
    documents: [
      {
        id: 'chunk-1',
        content: '合同第七条说明试用数据删除时限。',
        source: 'contract.md',
        chunk_index: 7,
        category: null,
        similarity: 0.9,
      },
    ],
    topDocuments: [
      {
        id: 'chunk-1',
        content: '合同第七条说明试用数据删除时限。',
        source: 'contract.md',
        chunk_index: 7,
        category: null,
        similarity: 0.9,
      },
    ],
    evidenceChunks: [
      {
        id: 'chunk-1',
        content: '合同第七条说明试用数据删除时限。',
        source: 'contract.md',
        chunk_index: 7,
        category: null,
        similarity: 0.9,
      },
    ],
    webCitations: [],
    retrievalHistory: [
      {
        query: '合同删除条款是什么？',
        resultCount: 1,
      },
    ],
    retrievalTrace: [],
    retrievalStrategy: {
      name: 'balanced',
      needRetrieval: true,
      useVector: true,
      useKeyword: true,
      useGraph: false,
      useExactPhrase: true,
      useMultiQuery: true,
      allowWeb: true,
      reason: '需要知识库事实',
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
    retrievalStrategyReason: '需要知识库事实',
    routeAllowWeb: true,
    workflowStartedAt: Date.now(),
    workflowBudgetMs: 60_000,
    profileId: 'balanced_chat',
    useGraphExpand: true,
    evaluateMode: 'llm',
    rerankMode: 'llm',
    useLongTermMemory: true,
    routeMode: 'llm',
    shortTermMemory: { window: [], summary: '', activeContext: '' },
    longTermMemories: [],
    memoryContext: '',
    graphReasoningTrace: [],
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

  it('评估发现缺失事实且还有 hop 预算时，会扩展子问题并回到本地检索', async () => {
    const evidenceEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({
        enough: false,
        missingFacts: ['审计保留要求是什么？'],
        reason: '缺少审计保留要求',
        webQuery: '合同 审计 保留 要求',
      }),
    };
    const webFallbackService = {
      isEnabled: jest.fn().mockReturnValue(true),
    };
    const node = createEvaluateEvidenceNode(
      evidenceEvaluatorService as never,
      webFallbackService as never,
    );

    const command = await node(baseState, {
      configurable: {
        workflowInput: {
          signal: new AbortController().signal,
        },
      },
    } as never);

    expect(evidenceEvaluatorService.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        localChunks: baseState.topDocuments,
        remainingSubQuestionCount: 1,
      }),
    );
    expect(command.goto).toEqual(['retrieve']);
    expect(command.update).toMatchObject({
      enough: false,
      missingFacts: ['审计保留要求是什么？'],
      subQuestions: [
        '合同删除条款是什么？',
        '审计要求是什么？',
        '审计保留要求是什么？',
      ],
      stopReason: 'multi_hop_insufficient',
    });
  });

  it('simple 策略在证据不足时也能扩展缺失事实并回到本地检索', async () => {
    const evidenceEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({
        enough: false,
        missingFacts: ['试用期删除时限是几天？'],
        reason: '缺少关键时限',
        webQuery: '试用期 删除 时限',
      }),
    };
    const node = createEvaluateEvidenceNode(
      evidenceEvaluatorService as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
    );

    const command = await node(
      {
        ...baseState,
        strategy: 'simple',
        subQuestions: [],
        nextSubIdx: 1,
        currentHop: 1,
        maxHops: 3,
      } as RagGraphState,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(command.goto).toEqual(['retrieve']);
    expect(command.update).toMatchObject({
      enough: false,
      subQuestions: [
        '合同删除条款和审计要求是什么？',
        '试用期删除时限是几天？',
      ],
      stopReason: 'single_hop_insufficient',
    });
  });

  it('缺失事实但没有额外 hop 预算时，才会退到 web fallback', async () => {
    const evidenceEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({
        enough: false,
        missingFacts: ['审计保留要求是什么？'],
        reason: '缺少审计保留要求',
        webQuery: '合同 审计 保留 要求',
      }),
    };
    const webFallbackService = {
      isEnabled: jest.fn().mockReturnValue(true),
    };
    const node = createEvaluateEvidenceNode(
      evidenceEvaluatorService as never,
      webFallbackService as never,
    );

    const command = await node(
      {
        ...baseState,
        maxHops: 2,
      },
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(command.goto).toEqual(['web_fallback']);
    expect(command.update).toMatchObject({
      enough: false,
      missingFacts: ['审计保留要求是什么？'],
      stopReason: 'sub_questions_exhausted',
    });
  });

  it('已用过一次 web 但评估仍不足且给出新 query 时，会再次进入 web fallback', async () => {
    const evidenceEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({
        enough: false,
        missingFacts: ['监管更新时间是什么？'],
        reason: '第一次联网后仍缺少监管更新时间',
        webQuery: '合同 审计 监管 更新时间',
      }),
    };
    const webFallbackService = {
      isEnabled: jest.fn().mockReturnValue(true),
    };
    const node = createEvaluateEvidenceNode(
      evidenceEvaluatorService as never,
      webFallbackService as never,
    );

    const command = await node(
      {
        ...baseState,
        strategy: 'simple',
        subQuestions: [],
        currentHop: 1,
        maxHops: 1,
        webSearchAttempted: true,
        webSearchUsed: true,
        webSearchAttempts: 1,
        maxWebSearchAttempts: 2,
        webSearchQueries: ['合同 审计 保留 要求'],
      } as RagGraphState,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(command.goto).toEqual(['web_fallback']);
    expect(command.update).toMatchObject({
      enough: false,
      webQuery: '合同 审计 监管 更新时间',
      stopReason: 'web_fallback_retry',
    });
  });

  it('allowWeb=false 时不会进入 web_fallback，而是直接带着评估结果进入回答', async () => {
    const evidenceEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({
        enough: false,
        missingFacts: ['缺少外部事实'],
        reason: '本地证据不足',
        webQuery: '外部事实查询',
      }),
    };
    const node = createEvaluateEvidenceNode(
      evidenceEvaluatorService as never,
      {
        isEnabled: jest.fn(() => true),
      } as never,
    );

    const command = await node(
      {
        ...baseState,
        strategy: 'simple',
        subQuestions: [],
        nextSubIdx: 1,
        currentHop: 1,
        maxHops: 1,
        retrievalStrategy: {
          ...baseState.retrievalStrategy,
          allowWeb: false,
          reason: '禁止联网补充',
        },
        retrievalStrategyReason: '禁止联网补充',
      } as RagGraphState,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(command.goto).toEqual(['load_context']);
    expect(command.update).toMatchObject({
      enough: false,
      stopReason: 'web_fallback_disabled',
      webQuery: '外部事实查询',
    });
  });

  it('needRetrieval=false 时不评估空证据，直接进入 load_context', async () => {
    const evidenceEvaluatorService = {
      evaluate: jest.fn(),
    };
    const node = createEvaluateEvidenceNode(
      evidenceEvaluatorService as never,
      {
        isEnabled: jest.fn(() => true),
      } as never,
    );

    const command = await node(
      {
        ...baseState,
        question: '你好',
        strategy: 'simple',
        subQuestions: [],
        nextSubIdx: 1,
        currentQuery: '你好',
        currentHop: 1,
        documents: [],
        topDocuments: [],
        evidenceChunks: [],
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
        stopReason: 'retrieval_skipped',
      } as RagGraphState,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(evidenceEvaluatorService.evaluate).not.toHaveBeenCalled();
    expect(command.goto).toEqual(['load_context']);
    expect(command.update).toMatchObject({
      enough: true,
      missingFacts: [],
      evaluationReason: '寒暄问题，不需要查知识库',
      stopReason: 'retrieval_skipped',
    });
  });
});
