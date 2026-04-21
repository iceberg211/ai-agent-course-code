import { EvidenceEvaluatorService } from '@/agent/services/evidence-evaluator.service';

describe('EvidenceEvaluatorService', () => {
  it('会返回结构化评估结果', async () => {
    const service = new EvidenceEvaluatorService();
    const invoke = jest.fn().mockResolvedValue({
      enough: false,
      missingFacts: ['人物结局'],
      reason: '当前还缺结局信息',
      webQuery: '慕容复 最终结局',
    });

    Reflect.set(service, 'llm', {
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke,
      }),
    });

    await expect(
      service.evaluate({
        question: '慕容复最后怎么样了？',
        currentHop: 1,
        maxHops: 3,
        remainingSubQuestionCount: 1,
        localChunks: [
          {
            id: 'chunk-1',
            content: '慕容复是慕容博之子。',
            source: 'test.md',
            chunk_index: 0,
            category: null,
            similarity: 0.8,
          },
        ],
      }),
    ).resolves.toEqual({
      enough: false,
      missingFacts: ['人物结局'],
      reason: '当前还缺结局信息',
      webQuery: '慕容复 最终结局',
    });
  });

  it('评估失败时会稳定回退到启发式判断', async () => {
    const service = new EvidenceEvaluatorService();
    const invoke = jest.fn().mockRejectedValue(new Error('llm failed'));

    Reflect.set(service, 'llm', {
      withStructuredOutput: jest.fn().mockReturnValue({
        invoke,
      }),
    });

    await expect(
      service.evaluate({
        question: '慕容复最后怎么样了？',
        currentHop: 1,
        maxHops: 3,
        remainingSubQuestionCount: 1,
        localChunks: [],
      }),
    ).resolves.toEqual({
      enough: false,
      missingFacts: ['当前证据可能不足以覆盖完整答案'],
      reason: '启发式判断证据仍不足',
      webQuery: '慕容复最后怎么样了？',
    });
  });
});
