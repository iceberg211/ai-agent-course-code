import { DefaultRagOrchestratorService } from '@/agent/default-rag-orchestrator.service';

describe('DefaultRagOrchestratorService', () => {
  const chunk = {
    id: 'chunk-1',
    content: '雁门关事件相关片段',
    source: 'test.md',
    chunk_index: 0,
    category: null,
    similarity: 0.92,
  };

  function createService(strategy: 'simple' | 'complex') {
    const knowledgeContentService = {
      retrieveForPersona: jest.fn().mockResolvedValue([chunk]),
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
        strategy,
        reason: strategy === 'complex' ? '需要多步检索' : '直接问题',
      }),
    };
    const multiHopPlannerService = {
      planSubQuestions: jest.fn().mockResolvedValue({
        subQuestions: ['先查主谋是谁？', '再查儿子结局是什么？'],
        reason: '先实体后结局',
      }),
    };

    return {
      service: new DefaultRagOrchestratorService(
        knowledgeContentService as never,
        personaService as never,
        conversationService as never,
        answerGenerationService as never,
        ragRouteService as never,
        multiHopPlannerService as never,
      ),
      deps: {
        knowledgeContentService,
        personaService,
        conversationService,
        answerGenerationService,
        ragRouteService,
        multiHopPlannerService,
      },
    };
  }

  it('simple 路径会直接单跳检索并生成回答', async () => {
    const { service, deps } = createService('simple');
    const tokens: string[] = [];
    const citations: typeof chunk[] = [];

    const result = await service.run({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '萧峰是谁？',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
      onCitations: (items) => citations.push(...items),
    });

    expect(deps.multiHopPlannerService.planSubQuestions).not.toHaveBeenCalled();
    expect(deps.knowledgeContentService.retrieveForPersona).toHaveBeenCalledWith(
      'persona-1',
      '萧峰是谁？',
    );
    expect(tokens).toEqual(['答']);
    expect(citations).toEqual([chunk]);
    expect(result.state.strategy).toBe('simple');
    expect(result.state.subQuestions).toEqual([]);
  });

  it('complex 路径当前仍走单跳，但会保留规划信息', async () => {
    const { service, deps } = createService('complex');

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
    expect(result.state.strategy).toBe('complex');
    expect(result.state.routeReason).toBe('需要多步检索');
    expect(result.state.subQuestions).toEqual([
      '先查主谋是谁？',
      '再查儿子结局是什么？',
    ]);
    expect(result.citations).toEqual([chunk]);
  });

  it('请求已中断时会尽早停止，不再继续检索', async () => {
    const { service, deps } = createService('complex');
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
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(deps.ragRouteService.routeQuestion).not.toHaveBeenCalled();
    expect(deps.knowledgeContentService.retrieveForPersona).not.toHaveBeenCalled();
    expect(deps.answerGenerationService.generate).not.toHaveBeenCalled();
  });
});
