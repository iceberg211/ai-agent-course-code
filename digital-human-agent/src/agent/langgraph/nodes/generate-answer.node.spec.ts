import { createGenerateAnswerNode } from '@/agent/langgraph/nodes/generate-answer.node';

describe('createGenerateAnswerNode', () => {
  it('会把证据评估结果传给回答生成服务', async () => {
    const answerGenerationService = {
      generate: jest.fn().mockResolvedValue('回答'),
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
});
