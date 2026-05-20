import { createAbortError } from '@/common/utils';
import { LangGraphRagOrchestratorService } from '@/agent/orchestrators/langgraph-rag-orchestrator.service';

function createChunk(id: string, content: string) {
  return {
    id,
    content,
    source: `${id}.md`,
    chunk_index: 0,
    category: null,
    similarity: 0.9,
  };
}

function createWebCitation(title: string) {
  return {
    kind: 'web' as const,
    title,
    url: `https://example.com/${encodeURIComponent(title)}`,
    snippet: `${title} 的网页摘要`,
    siteName: '示例站点',
    publishedAt: '2026-04-21',
  };
}

function createTrace(query: string) {
  return {
    knowledgeId: 'kb-1',
    queryIndex: 0,
    query,
    keywords: [query],
    angle: 'original' as const,
    vectorBackend: 'pgvector' as const,
    keywordBackend: 'pg' as const,
    graphBackend: 'disabled' as const,
    vectorResultCount: 1,
    keywordResultCount: 1,
    mergedResultCount: 1,
    fallbackToPg: false,
    skippedChannels: [],
  };
}

function createAugmentation(
  question: string,
  overrides?: Partial<{
    needRetrieval: boolean;
    useVector: boolean;
    useKeyword: boolean;
    useGraph: boolean;
    useExactPhrase: boolean;
    useMultiQuery: boolean;
    allowWeb: boolean;
    reason: string;
    retrievalQueries: Array<{
      index: number;
      query: string;
      keywords: string[];
      angle: 'original' | 'semantic' | 'entity' | 'detail' | 'symptom';
    }>;
  }>,
) {
  const retrievalQueries = overrides?.retrievalQueries ?? [
    {
      index: 0,
      query: question,
      keywords: [question],
      angle: 'original' as const,
    },
  ];

  return {
    currentQuery: question,
    rewrite: {
      originalQuery: question,
      rewrittenQuery: retrievalQueries[0]?.query ?? question,
      keywords: retrievalQueries[0]?.keywords ?? [question],
      expandedQueries: retrievalQueries,
      changed: false,
      reason: overrides?.reason ?? '测试增强',
    },
    retrievalQueries,
    strategy: {
      needRetrieval: overrides?.needRetrieval ?? true,
      useVector: overrides?.useVector ?? true,
      useKeyword: overrides?.useKeyword ?? true,
      useGraph: overrides?.useGraph ?? false,
      useExactPhrase: overrides?.useExactPhrase ?? false,
      useMultiQuery: overrides?.useMultiQuery ?? retrievalQueries.length > 1,
      allowWeb: overrides?.allowWeb ?? true,
      reason: overrides?.reason ?? '测试默认检索策略',
    },
  };
}

describe('LangGraphRagOrchestratorService', () => {
  function createService(options?: {
    routeStrategy?: 'simple' | 'complex' | 'none';
    plannerQuestions?: string[];
    retrieveMap?: Record<string, ReturnType<typeof createChunk>[]>;
    augmentationMap?: Record<string, ReturnType<typeof createAugmentation>>;
    retrieveFailuresBeforeSuccess?: number;
    rerankResult?: ReturnType<typeof createChunk>[];
    webEnabled?: boolean;
    evaluations?: Array<{
      enough: boolean;
      missingFacts?: string[];
      reason: string;
      webQuery?: string;
    }>;
    webResults?: ReturnType<typeof createWebCitation>[];
    webSearchError?: Error;
    webSearchFailuresBeforeSuccess?: number;
    personaFailuresBeforeSuccess?: number;
  }) {
    let retrieveFailuresBeforeSuccess =
      options?.retrieveFailuresBeforeSuccess ?? 0;
    const personaStage1RetrievalService = {
      retrieveForPersona: jest
        .fn()
        .mockImplementation(async ({ retrievalQueries }) => {
          if (retrieveFailuresBeforeSuccess > 0) {
            retrieveFailuresBeforeSuccess -= 1;
            throw new Error('temporary retrieve failure');
          }

          const query = retrievalQueries[0]?.query ?? '';
          return {
            knowledgeCount: 1,
            chunks: options?.retrieveMap?.[query] ?? [],
            trace: query ? [createTrace(query)] : [],
          };
        }),
    };
    let personaFailuresBeforeSuccess =
      options?.personaFailuresBeforeSuccess ?? 0;
    const personaService = {
      findOne: jest.fn().mockImplementation(async () => {
        if (personaFailuresBeforeSuccess > 0) {
          personaFailuresBeforeSuccess -= 1;
          throw new Error('temporary persona failure');
        }
        return {
          id: 'persona-1',
          name: '乔峰',
          description: '豪迈',
          speakingStyle: '直接',
          expertise: ['江湖'],
          systemPromptExtra: null,
        };
      }),
    };
    const conversationService = {
      getCompletedMessages: jest.fn().mockResolvedValue([]),
    };
    const answerGenerationService = {
      generate: jest.fn().mockImplementation(async (params) => {
        params.onToken('答');
        return '答案';
      }),
      generateDirect: jest.fn().mockImplementation(async (params) => {
        params.onToken('闲');
        return '闲聊回答';
      }),
    };
    const ragRouteService = {
      routeQuestion: jest.fn().mockResolvedValue({
        strategy: options?.routeStrategy ?? 'simple',
        reason:
          options?.routeStrategy === 'complex'
            ? '需要多跳检索'
            : options?.routeStrategy === 'none'
              ? '无需检索的闲聊'
              : '直接问题',
      }),
    };
    const queryAugmentationService = {
      plan: jest.fn().mockImplementation(async ({ question }) => {
        return (
          options?.augmentationMap?.[question] ?? createAugmentation(question)
        );
      }),
    };
    const multiHopPlannerService = {
      planSubQuestions: jest.fn().mockResolvedValue({
        subQuestions: options?.plannerQuestions ?? [
          '先查主谋是谁？',
          '再查儿子结局是什么？',
        ],
        reason: '先前置事实，再查结局',
      }),
    };
    const rerankerService = {
      rerank: jest.fn().mockImplementation(async (_question, documents) => {
        return options?.rerankResult ?? documents;
      }),
    };
    const evaluations = [...(options?.evaluations ?? [])];
    const evidenceEvaluatorService = {
      evaluate: jest.fn().mockImplementation(async () => {
        const next = evaluations.shift();
        return (
          next ?? {
            enough: true,
            missingFacts: [],
            reason: '证据足够',
            webQuery: '',
          }
        );
      }),
    };
    let webSearchFailuresBeforeSuccess =
      options?.webSearchFailuresBeforeSuccess ?? 0;
    const webFallbackService = {
      isEnabled: jest.fn().mockReturnValue(options?.webEnabled ?? true),
      search: jest.fn().mockImplementation(async () => {
        if (webSearchFailuresBeforeSuccess > 0) {
          webSearchFailuresBeforeSuccess -= 1;
          throw new Error('temporary web search failure');
        }
        if (options?.webSearchError) {
          throw options.webSearchError;
        }
        return options?.webResults ?? [];
      }),
    };

    return {
      service: new LangGraphRagOrchestratorService(
        personaStage1RetrievalService as never,
        personaService as never,
        conversationService as never,
        answerGenerationService as never,
        ragRouteService as never,
        queryAugmentationService as never,
        multiHopPlannerService as never,
        rerankerService as never,
        evidenceEvaluatorService as never,
        webFallbackService as never,
      ),
      deps: {
        personaStage1RetrievalService,
        personaService,
        conversationService,
        answerGenerationService,
        ragRouteService,
        queryAugmentationService,
        multiHopPlannerService,
        rerankerService,
        evidenceEvaluatorService,
        webFallbackService,
      },
    };
  }

  it('simple 路径会单轮 retrieve、显式 rerank 后生成回答', async () => {
    const chunk = createChunk('chunk-1', '乔峰是丐帮帮主。');
    const { service, deps } = createService({
      routeStrategy: 'simple',
      retrieveMap: {
        '乔峰是谁？': [chunk],
      },
      evaluations: [
        {
          enough: true,
          reason: '本地证据已足够回答',
          missingFacts: [],
          webQuery: '',
        },
      ],
    });
    const tokens: string[] = [];
    const onCitations = jest.fn();

    const result = await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '乔峰是谁？',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
      onCitations,
    });

    expect(deps.multiHopPlannerService.planSubQuestions).not.toHaveBeenCalled();
    expect(deps.queryAugmentationService.plan).toHaveBeenCalledWith({
      question: '乔峰是谁？',
      routeStrategy: 'simple',
      signal: expect.any(AbortSignal),
    });
    expect(
      deps.personaStage1RetrievalService.retrieveForPersona,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        personaId: 'persona-1',
        retrievalQueries: [
          expect.objectContaining({
            query: '乔峰是谁？',
          }),
        ],
      }),
    );
    expect(deps.rerankerService.rerank).toHaveBeenCalledWith(
      '乔峰是谁？',
      [chunk],
      5,
      expect.any(AbortSignal),
    );
    expect(deps.webFallbackService.search).not.toHaveBeenCalled();
    expect(deps.answerGenerationService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        localChunks: [chunk],
        webCitations: [],
      }),
    );
    expect(tokens).toEqual(['答']);
    expect(onCitations).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: 'knowledge',
        id: 'chunk-1',
      }),
    ]);
    expect(result.state.orchestrator).toBe('langgraph');
    expect(result.state.plannedNext).toBe('rerank');
    expect(result.state.topDocuments).toEqual([chunk]);
    expect(result.state.stopReason).toBe('single_hop_enough');
  });

  it('needRetrieval=false 时会跳过 persona stage1 与证据评估', async () => {
    const { service, deps } = createService({
      routeStrategy: 'simple',
      augmentationMap: {
        你好: createAugmentation('你好', {
          needRetrieval: false,
          useVector: false,
          useKeyword: false,
          allowWeb: false,
          reason: '寒暄问题，不需要查知识库',
        }),
      },
    });

    const result = await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '你好',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: jest.fn(),
      onCitations: jest.fn(),
    });

    expect(
      deps.personaStage1RetrievalService.retrieveForPersona,
    ).not.toHaveBeenCalled();
    expect(deps.rerankerService.rerank).not.toHaveBeenCalled();
    expect(deps.evidenceEvaluatorService.evaluate).not.toHaveBeenCalled();
    expect(deps.answerGenerationService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        localChunks: [],
        webCitations: [],
      }),
    );
    expect(result.state.stopReason).toBe('retrieval_skipped');
    expect(result.state.retrievalHistory).toEqual([
      expect.objectContaining({
        query: '你好',
        resultCount: 0,
        skipped: true,
        reason: '寒暄问题，不需要查知识库',
      }),
    ]);
  });

  it('none 路由会直达轻量回答并跳过检索、评估和上下文加载', async () => {
    const { service, deps } = createService({
      routeStrategy: 'none',
    });
    const tokens: string[] = [];
    const onCitations = jest.fn();

    const result = await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '你好',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
      onCitations,
    });

    expect(deps.multiHopPlannerService.planSubQuestions).not.toHaveBeenCalled();
    expect(deps.queryAugmentationService.plan).not.toHaveBeenCalled();
    expect(
      deps.personaStage1RetrievalService.retrieveForPersona,
    ).not.toHaveBeenCalled();
    expect(deps.rerankerService.rerank).not.toHaveBeenCalled();
    expect(deps.evidenceEvaluatorService.evaluate).not.toHaveBeenCalled();
    expect(deps.personaService.findOne).not.toHaveBeenCalled();
    expect(
      deps.conversationService.getCompletedMessages,
    ).not.toHaveBeenCalled();
    expect(deps.answerGenerationService.generate).not.toHaveBeenCalled();
    expect(deps.answerGenerationService.generateDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: '你好',
        personaId: 'persona-1',
      }),
    );
    expect(tokens).toEqual(['闲']);
    expect(onCitations).not.toHaveBeenCalled();
    expect(result.answerText).toBe('闲聊回答');
    expect(result.state.strategy).toBe('none');
    expect(result.state.retrievalTrace).toEqual([]);
    expect(result.citations).toEqual([]);
  });

  it('complex 路径会先完成多轮 retrieve，再统一 rerank 与评估', async () => {
    const chunkA = createChunk('chunk-a', '雁门关事件主谋是慕容博。');
    const chunkB = createChunk('chunk-b', '慕容博的儿子最终疯癫。');
    const { service, deps } = createService({
      routeStrategy: 'complex',
      plannerQuestions: ['雁门关事件主谋是谁？', '慕容博的儿子结局是什么？'],
      retrieveMap: {
        '雁门关事件主谋是谁？': [chunkA],
        '慕容博的儿子结局是什么？': [chunkB],
      },
      evaluations: [
        {
          enough: true,
          reason: '两轮证据已经齐全',
          missingFacts: [],
          webQuery: '',
        },
      ],
    });

    const result = await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '雁门关事件的主谋是谁，他儿子的结局是什么？',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: jest.fn(),
      onCitations: jest.fn(),
    });

    expect(deps.multiHopPlannerService.planSubQuestions).toHaveBeenCalled();
    expect(
      deps.personaStage1RetrievalService.retrieveForPersona,
    ).toHaveBeenCalledTimes(2);
    expect(
      deps.personaStage1RetrievalService.retrieveForPersona,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        retrievalQueries: [
          expect.objectContaining({
            query: '雁门关事件主谋是谁？',
          }),
        ],
      }),
    );
    expect(
      deps.personaStage1RetrievalService.retrieveForPersona,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        retrievalQueries: [
          expect.objectContaining({
            query: '慕容博的儿子结局是什么？',
          }),
        ],
      }),
    );
    expect(deps.rerankerService.rerank).toHaveBeenCalledWith(
      '雁门关事件的主谋是谁，他儿子的结局是什么？',
      [chunkA, chunkB],
      5,
      expect.any(AbortSignal),
    );
    expect(deps.evidenceEvaluatorService.evaluate).toHaveBeenCalledTimes(1);
    expect(deps.answerGenerationService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        localChunks: [chunkA, chunkB],
      }),
    );
    expect(result.state.strategy).toBe('complex');
    expect(result.state.currentHop).toBe(2);
    expect(result.state.nextSubIdx).toBe(2);
    expect(result.state.stopReason).toBe('multi_hop_enough');
  });

  it('complex 路径评估出 missingFacts 且仍有 hop 预算时，会回到本地补检索后再生成回答', async () => {
    const chunkA = createChunk('chunk-a', '雁门关事件主谋是慕容博。');
    const chunkB = createChunk('chunk-b', '慕容博的儿子最终疯癫。');
    const chunkC = createChunk('chunk-c', '监管更新时间是 2026 年春。');
    const { service, deps } = createService({
      routeStrategy: 'complex',
      plannerQuestions: ['雁门关事件主谋是谁？', '慕容博的儿子结局是什么？'],
      retrieveMap: {
        '雁门关事件主谋是谁？': [chunkA],
        '慕容博的儿子结局是什么？': [chunkB],
        '监管更新时间是什么？': [chunkC],
      },
      evaluations: [
        {
          enough: false,
          reason: '还缺监管更新时间',
          missingFacts: ['监管更新时间是什么？'],
          webQuery: '雁门关事件 监管 更新时间',
        },
        {
          enough: true,
          reason: '补检索后证据足够',
          missingFacts: [],
          webQuery: '',
        },
      ],
    });

    const result = await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '雁门关事件的主谋是谁，他儿子的结局是什么？',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: jest.fn(),
      onCitations: jest.fn(),
    });

    expect(
      deps.personaStage1RetrievalService.retrieveForPersona,
    ).toHaveBeenCalledTimes(3);
    expect(
      deps.personaStage1RetrievalService.retrieveForPersona,
    ).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        retrievalQueries: [
          expect.objectContaining({
            query: '监管更新时间是什么？',
          }),
        ],
      }),
    );
    expect(deps.evidenceEvaluatorService.evaluate).toHaveBeenCalledTimes(2);
    expect(deps.webFallbackService.search).not.toHaveBeenCalled();
    expect(deps.answerGenerationService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        localChunks: [chunkA, chunkB, chunkC],
      }),
    );
    expect(result.state.subQuestions).toEqual([
      '雁门关事件主谋是谁？',
      '慕容博的儿子结局是什么？',
      '监管更新时间是什么？',
    ]);
    expect(result.state.currentHop).toBe(3);
    expect(result.state.nextSubIdx).toBe(3);
    expect(result.state.stopReason).toBe('multi_hop_enough');
  });

  it('本地证据不足时会触发 web fallback，补充后再次评估并生成回答', async () => {
    const localChunk = createChunk('chunk-1', '本地只提到雁门关事件。');
    const webCitation = createWebCitation('雁门关事件补充资料');
    const { service, deps } = createService({
      routeStrategy: 'simple',
      retrieveMap: {
        '雁门关事件最新资料是什么？': [localChunk],
      },
      evaluations: [
        {
          enough: false,
          reason: '本地证据不足，需要联网补充',
          missingFacts: ['最新资料'],
          webQuery: '雁门关事件 最新资料',
        },
        {
          enough: true,
          reason: '联网补充后证据足够',
          missingFacts: [],
          webQuery: '',
        },
      ],
      webResults: [webCitation],
    });

    const result = await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '雁门关事件最新资料是什么？',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: jest.fn(),
      onCitations: jest.fn(),
    });

    expect(deps.evidenceEvaluatorService.evaluate).toHaveBeenCalledTimes(2);
    expect(deps.webFallbackService.search).toHaveBeenCalledWith({
      query: '雁门关事件 最新资料',
      signal: expect.any(AbortSignal),
    });
    expect(deps.answerGenerationService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        localChunks: [localChunk],
        webCitations: [webCitation],
      }),
    );
    expect(result.state.webSearchUsed).toBe(true);
    expect(result.state.stopReason).toBe('web_fallback_enough');
  });

  it('联网补充失败后会直接进入回答，不会再次触发证据评估', async () => {
    const localChunk = createChunk('chunk-1', '本地证据不足。');
    const { service, deps } = createService({
      routeStrategy: 'simple',
      retrieveMap: {
        需要联网的问题: [localChunk],
      },
      evaluations: [
        {
          enough: false,
          reason: '需要联网',
          missingFacts: ['缺少补充资料'],
          webQuery: '需要联网的问题 最新进展',
        },
      ],
      webSearchError: new Error('search failed'),
    });

    const result = await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '需要联网的问题',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: jest.fn(),
      onCitations: jest.fn(),
    });

    expect(deps.webFallbackService.search).toHaveBeenCalledTimes(1);
    expect(deps.evidenceEvaluatorService.evaluate).toHaveBeenCalledTimes(1);
    expect(deps.answerGenerationService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        localChunks: [localChunk],
        webCitations: [],
      }),
    );
    expect(result.state.webSearchAttempted).toBe(true);
    expect(result.state.webSearchUsed).toBe(false);
    expect(result.state.stopReason).toBe('web_fallback_failed');
    expect(result.state.evaluationReason).toBe('需要联网');
  });

  it('本地检索出现瞬时错误时会自动重试后继续完成回答', async () => {
    const chunk = createChunk('chunk-1', '乔峰是丐帮帮主。');
    const { service, deps } = createService({
      routeStrategy: 'simple',
      retrieveFailuresBeforeSuccess: 1,
      retrieveMap: {
        '乔峰是谁？': [chunk],
      },
      evaluations: [
        {
          enough: true,
          reason: '证据足够',
          missingFacts: [],
          webQuery: '',
        },
      ],
    });

    const result = await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '乔峰是谁？',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: jest.fn(),
      onCitations: jest.fn(),
    });

    expect(
      deps.personaStage1RetrievalService.retrieveForPersona,
    ).toHaveBeenCalledTimes(2);
    expect(result.answerText).toBe('答案');
    expect(result.state.stopReason).toBe('single_hop_enough');
  });

  it('联网补充出现瞬时错误时会自动重试，成功后继续评估并回答', async () => {
    const localChunk = createChunk('chunk-1', '本地只提到雁门关事件。');
    const webCitation = createWebCitation('雁门关事件补充资料');
    const { service, deps } = createService({
      routeStrategy: 'simple',
      retrieveMap: {
        '雁门关事件最新资料是什么？': [localChunk],
      },
      evaluations: [
        {
          enough: false,
          reason: '本地证据不足，需要联网补充',
          missingFacts: ['最新资料'],
          webQuery: '雁门关事件 最新资料',
        },
        {
          enough: true,
          reason: '联网补充后证据足够',
          missingFacts: [],
          webQuery: '',
        },
      ],
      webSearchFailuresBeforeSuccess: 1,
      webResults: [webCitation],
    });

    const result = await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '雁门关事件最新资料是什么？',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: jest.fn(),
      onCitations: jest.fn(),
    });

    expect(deps.webFallbackService.search).toHaveBeenCalledTimes(2);
    expect(result.state.webSearchUsed).toBe(true);
    expect(result.state.stopReason).toBe('web_fallback_enough');
  });

  it('加载上下文出现瞬时错误时会自动重试后再生成回答', async () => {
    const chunk = createChunk('chunk-1', '乔峰是丐帮帮主。');
    const { service, deps } = createService({
      routeStrategy: 'simple',
      retrieveMap: {
        '乔峰是谁？': [chunk],
      },
      personaFailuresBeforeSuccess: 1,
      evaluations: [
        {
          enough: true,
          reason: '本地证据已足够回答',
          missingFacts: [],
          webQuery: '',
        },
      ],
    });

    const result = await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '乔峰是谁？',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: jest.fn(),
      onCitations: jest.fn(),
    });

    expect(deps.personaService.findOne).toHaveBeenCalledTimes(2);
    expect(result.answerText).toBe('答案');
    expect(result.state.stopReason).toBe('single_hop_enough');
  });

  it('请求已中断时会尽早停止，不再继续执行图节点', async () => {
    const { service, deps } = createService({
      routeStrategy: 'complex',
    });
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      service.run({
        conversationId: 'conv-1',
        personaId: 'persona-1',
        question: '复杂问题',
        turnId: 'turn-1',
        signal: abortController.signal,
        onToken: jest.fn(),
        onCitations: jest.fn(),
      }),
    ).rejects.toMatchObject(createAbortError());

    expect(deps.ragRouteService.routeQuestion).not.toHaveBeenCalled();
    expect(
      deps.personaStage1RetrievalService.retrieveForPersona,
    ).not.toHaveBeenCalled();
    expect(deps.answerGenerationService.generate).not.toHaveBeenCalled();
  });
});
