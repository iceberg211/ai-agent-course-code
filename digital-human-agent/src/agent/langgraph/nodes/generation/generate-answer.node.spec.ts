import { createGenerateAnswerNode } from '@/agent/langgraph/nodes/generation/generate-answer.node';

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
        evidenceChunks: [],
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

  it('none 策略会直接生成闲聊回答，不要求 persona 上下文', async () => {
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

    const result = await node(
      {
        strategy: 'none',
        persona: null,
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
    });
    expect(result).toEqual({ answerText: '你好，有什么想聊的？' });
  });
});
