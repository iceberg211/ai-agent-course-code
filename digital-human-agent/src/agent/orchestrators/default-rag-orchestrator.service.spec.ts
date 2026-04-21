import { createAbortError } from '@/agent/agent.utils';
import { DefaultRagOrchestratorService } from '@/agent/orchestrators/default-rag-orchestrator.service';

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

describe('DefaultRagOrchestratorService', () => {
  function createService(options?: {
    routeStrategy?: 'simple' | 'complex';
    plannerQuestions?: string[];
    retrieveMap?: Record<string, ReturnType<typeof createChunk>[]>;
    evaluations?: Array<{
      enough: boolean;
      missingFacts?: string[];
      reason: string;
      webQuery?: string;
    }>;
    webResults?: ReturnType<typeof createWebCitation>[];
    webSearchError?: Error;
  }) {
    const knowledgeSearchService = {
      retrieveForPersona: jest.fn().mockImplementation((_personaId, query) =>
        Promise.resolve(options?.retrieveMap?.[query] ?? []),
      ),
    };
    const personaService = {
      findOne: jest.fn().mockResolvedValue({
        id: 'persona-1',
        name: '乔峰',
        description: '豪迈',
        speakingStyle: '直接',
        expertise: ['江湖'],
        systemPromptExtra: null,
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
    };
    const ragRouteService = {
      routeQuestion: jest.fn().mockResolvedValue({
        strategy: options?.routeStrategy ?? 'simple',
        reason:
          options?.routeStrategy === 'complex' ? '需要多跳检索' : '直接问题',
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
    const webFallbackService = {
      isEnabled: jest.fn().mockReturnValue(true),
      search: jest.fn().mockImplementation(async () => {
        if (options?.webSearchError) {
          throw options.webSearchError;
        }
        return options?.webResults ?? [];
      }),
    };

    return {
      service: new DefaultRagOrchestratorService(
        knowledgeSearchService as never,
        personaService as never,
        conversationService as never,
        answerGenerationService as never,
        ragRouteService as never,
        multiHopPlannerService as never,
        evidenceEvaluatorService as never,
        webFallbackService as never,
      ),
      deps: {
        knowledgeSearchService,
        personaService,
        conversationService,
        answerGenerationService,
        ragRouteService,
        multiHopPlannerService,
        evidenceEvaluatorService,
        webFallbackService,
      },
    };
  }

  it('simple 路径会单跳检索并直接生成回答', async () => {
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
    expect(deps.knowledgeSearchService.retrieveForPersona).toHaveBeenCalledWith(
      'persona-1',
      '乔峰是谁？',
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
    expect(result.state.strategy).toBe('simple');
    expect(result.state.stopReason).toBe('single_hop_enough');
  });

  it('complex 路径会按子问题逐跳检索，证据足够后停止', async () => {
    const chunkA = createChunk('chunk-a', '雁门关事件主谋是慕容博。');
    const chunkB = createChunk('chunk-b', '慕容复最终结局疯癫。');
    const { service, deps } = createService({
      routeStrategy: 'complex',
      plannerQuestions: ['雁门关事件主谋是谁？', '慕容博的儿子结局是什么？'],
      retrieveMap: {
        '雁门关事件主谋是谁？': [chunkA],
        '慕容博的儿子结局是什么？': [chunkB],
      },
      evaluations: [
        {
          enough: false,
          reason: '还缺儿子结局',
          missingFacts: ['儿子结局'],
          webQuery: '',
        },
        {
          enough: true,
          reason: '两跳证据已经齐全',
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
    expect(deps.knowledgeSearchService.retrieveForPersona).toHaveBeenNthCalledWith(
      1,
      'persona-1',
      '雁门关事件主谋是谁？',
    );
    expect(deps.knowledgeSearchService.retrieveForPersona).toHaveBeenNthCalledWith(
      2,
      'persona-1',
      '慕容博的儿子结局是什么？',
    );
    expect(deps.webFallbackService.search).not.toHaveBeenCalled();
    expect(deps.answerGenerationService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        localChunks: [chunkA, chunkB],
      }),
    );
    expect(result.state.strategy).toBe('complex');
    expect(result.state.currentHop).toBe(2);
    expect(result.state.subQuestions).toEqual([
      '雁门关事件主谋是谁？',
      '慕容博的儿子结局是什么？',
    ]);
    expect(result.state.stopReason).toBe('multi_hop_enough');
  });

  it('本地证据不足时会触发联网补充，再带着网页证据生成回答', async () => {
    const localChunk = createChunk('chunk-1', '本地只提到雁门关事件。');
    const webCitation = createWebCitation('雁门关事件补充资料');
    const onCitations = jest.fn();
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
      onCitations,
    });

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
    expect(result.citations).toEqual([
      expect.objectContaining({ kind: 'knowledge', id: 'chunk-1' }),
      webCitation,
    ]);
    expect(onCitations).toHaveBeenLastCalledWith([
      expect.objectContaining({ kind: 'knowledge', id: 'chunk-1' }),
      webCitation,
    ]);
  });

  it('联网补充失败时不会打断主链路，会继续使用本地证据回答', async () => {
    const localChunk = createChunk('chunk-1', '本地证据不足。');
    const { service, deps } = createService({
      routeStrategy: 'simple',
      retrieveMap: {
        '需要联网的问题': [localChunk],
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

    expect(deps.webFallbackService.search).toHaveBeenCalled();
    expect(deps.answerGenerationService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        localChunks: [localChunk],
        webCitations: [],
      }),
    );
    expect(result.state.webSearchUsed).toBe(false);
    expect(result.state.stopReason).toBe('web_fallback_failed');
  });

  it('请求已中断时会尽早停止，不再继续检索', async () => {
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
    expect(deps.knowledgeSearchService.retrieveForPersona).not.toHaveBeenCalled();
    expect(deps.answerGenerationService.generate).not.toHaveBeenCalled();
  });
});
