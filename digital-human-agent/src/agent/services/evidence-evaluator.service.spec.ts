import {
  buildFallbackEvaluation,
  EvidenceEvaluatorService,
} from '@/agent/services/evidence-evaluator.service';

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

  it('启发式评估：单条中高相关本地证据即判足够（实时语音单跳场景）', () => {
    const result = buildFallbackEvaluation({
      question: '公司总部在哪里？',
      currentHop: 1,
      maxHops: 1,
      remainingSubQuestionCount: 0,
      profileId: 'realtime_voice',
      localChunks: [
        {
          id: 'c1',
          content: '公司总部位于杭州。',
          source: 'company.md',
          chunk_index: 0,
          category: null,
          similarity: 0.8,
        },
      ],
      webCitations: [],
    });
    expect(result.enough).toBe(true);
    expect(result.missingFacts).toEqual([]);
  });

  it('启发式评估：非实时 profile 的单条证据不足以提前结束复杂检索', () => {
    const result = buildFallbackEvaluation({
      question: '比较 A 与 B 并说明差异',
      currentHop: 1,
      maxHops: 3,
      remainingSubQuestionCount: 2,
      profileId: 'balanced_chat',
      localChunks: [
        {
          id: 'c1',
          content: '这里只包含 A 的信息。',
          source: 'a.md',
          chunk_index: 0,
          category: null,
          similarity: 0.8,
        },
      ],
      webCitations: [],
    });
    expect(result.enough).toBe(false);
  });

  it('启发式评估：仅有低相关或低相似度证据时仍判不足', () => {
    const result = buildFallbackEvaluation({
      question: '公司总部在哪里？',
      currentHop: 1,
      maxHops: 1,
      remainingSubQuestionCount: 0,
      localChunks: [
        {
          id: 'c1',
          content: '公司成立于2010年。',
          source: 'company.md',
          chunk_index: 0,
          category: null,
          similarity: 0.3,
        },
      ],
      webCitations: [],
    });
    expect(result.enough).toBe(false);
  });
});
