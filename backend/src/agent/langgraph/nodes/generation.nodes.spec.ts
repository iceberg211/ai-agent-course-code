import {
  createLoadContextNode,
  createGenerateAnswerNode,
} from '@/agent/langgraph/nodes/generation.nodes';

describe('createLoadContextNode', () => {
  function buildWorkflowInput(turnId: string) {
    return {
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '当前问题',
      turnId,
      signal: new AbortController().signal,
      onToken: jest.fn(),
      onCitations: jest.fn(),
    };
  }

  it('不会把当前 turn 的消息回灌到提示词 history', async () => {
    const persona = { id: 'persona-1', name: '乔峰' };
    const history = [
      { turnId: 'turn-1', role: 'user', content: '上一轮问题' },
      { turnId: 'turn-1', role: 'assistant', content: '上一轮回答' },
      { turnId: 'turn-2', role: 'user', content: '当前问题' },
    ];
    const personaService = {
      findOne: jest.fn().mockResolvedValue(persona),
    };
    const conversationService = {
      getCompletedMessages: jest.fn().mockResolvedValue(history),
    };
    const node = createLoadContextNode(
      personaService as never,
      conversationService as never,
    );

    const result = await node(
      { strategy: 'simple' } as never,
      {
        context: {
          workflowInput: buildWorkflowInput('turn-2'),
        },
      } as never,
    );

    expect(conversationService.getCompletedMessages).toHaveBeenCalledWith(
      'conv-1',
      10,
    );
    expect(result.goto).toEqual(['load_generation_memory']);
    expect(result.update).toEqual(
      expect.objectContaining({
        persona,
        history: history.slice(0, 2),
      }),
    );
  });

  it('会丢弃末尾没有 assistant 响应的历史用户消息', async () => {
    const history = [
      { turnId: 'turn-1', role: 'user', content: '第一轮问题' },
      { turnId: 'turn-1', role: 'assistant', content: '第一轮回答' },
      { turnId: 'turn-2', role: 'user', content: '中断后残留的问题' },
    ];
    const personaService = {
      findOne: jest.fn().mockResolvedValue({ id: 'persona-1' }),
    };
    const conversationService = {
      getCompletedMessages: jest.fn().mockResolvedValue(history),
    };
    const node = createLoadContextNode(
      personaService as never,
      conversationService as never,
    );

    const result = await node(
      { strategy: 'simple' } as never,
      {
        context: {
          workflowInput: buildWorkflowInput('turn-3'),
        },
      } as never,
    );

    expect(
      (result.update as { history: unknown[] } | undefined)?.history,
    ).toEqual(history.slice(0, 2));
  });

  it('none 策略加载 persona 后直跳 generate_answer', async () => {
    const persona = { id: 'persona-1', name: '乔峰' };
    const personaService = {
      findOne: jest.fn().mockResolvedValue(persona),
    };
    const conversationService = {
      getCompletedMessages: jest.fn().mockResolvedValue([]),
    };
    const node = createLoadContextNode(
      personaService as never,
      conversationService as never,
    );

    const result = await node(
      { strategy: 'none' } as never,
      {
        context: {
          workflowInput: buildWorkflowInput('turn-1'),
        },
      } as never,
    );

    expect(result.goto).toEqual(['generate_answer']);
    expect(
      (result.update as { persona: unknown } | undefined)?.persona,
    ).toEqual(persona);
  });
});

describe('createGenerateAnswerNode', () => {
  it('会把证据评估结果传给回答生成服务', async () => {
    const answerGenerationService = {
      generate: jest.fn().mockResolvedValue('回答'),
    };
    const topChunk = {
      id: 'chunk-1',
      content: '合同原文',
      source: 'contract.md',
      chunk_index: 0,
      category: null,
      similarity: 0.9,
    };
    const node = createGenerateAnswerNode(answerGenerationService as never);
    const input = {
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '当前问题',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: jest.fn(),
      onCitations: jest.fn(),
    };

    const result = await node(
      {
        persona: { id: 'persona-1', name: '法务顾问' },
        history: [],
        topDocuments: [topChunk],
        retrievalStrategy: { needRetrieval: true },
        webCitations: [],
        enough: false,
        missingFacts: ['缺少原文'],
        evaluationReason: '证据不足',
        stopReason: 'single_hop_insufficient',
      } as never,
      {
        context: {
          workflowInput: input,
        },
      } as never,
    );

    expect(answerGenerationService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        localChunks: [topChunk],
        evidenceAssessment: {
          enough: false,
          missingFacts: ['缺少原文'],
          evaluationReason: '证据不足',
          stopReason: 'single_hop_insufficient',
        },
      }),
    );
    expect(result).toEqual({ answerText: '回答' });
  });

  it('none 策略用 persona 轻量生成闲聊回答', async () => {
    const answerGenerationService = {
      generate: jest.fn(),
      generateDirect: jest.fn().mockResolvedValue('你好，有什么想聊的？'),
    };
    const node = createGenerateAnswerNode(answerGenerationService as never);
    const input = {
      conversationId: 'conv-1',
      personaId: 'persona-1',
      question: '你好',
      turnId: 'turn-1',
      signal: new AbortController().signal,
      onToken: jest.fn(),
      onCitations: jest.fn(),
    };
    const persona = { id: 'persona-1', name: '乔峰' };

    const result = await node(
      {
        strategy: 'none',
        persona,
        history: [],
        topDocuments: [],
        webCitations: [],
        enough: null,
      } as never,
      {
        context: {
          workflowInput: input,
        },
      } as never,
    );

    expect(answerGenerationService.generate).not.toHaveBeenCalled();
    expect(answerGenerationService.generateDirect).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      personaId: 'persona-1',
      turnId: 'turn-1',
      userMessage: '你好',
      signal: input.signal,
      onToken: input.onToken,
      persona,
      history: [],
    });
    expect(result).toEqual({ answerText: '你好，有什么想聊的？' });
  });
});
