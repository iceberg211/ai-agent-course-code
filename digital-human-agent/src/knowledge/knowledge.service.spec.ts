import { KnowledgeService } from './knowledge.service';
import type { NormalizedRetrieveOptions } from './domain/retrieval.types';

describe('KnowledgeService', () => {
  let service: KnowledgeService;

  beforeEach(() => {
    service = new KnowledgeService(
      { delete: jest.fn(), save: jest.fn(), create: jest.fn(), update: jest.fn(), find: jest.fn(), findOneBy: jest.fn() } as never,
      { createQueryBuilder: jest.fn(), find: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  function buildOptions(
    input: Partial<NormalizedRetrieveOptions>,
  ): { kbId: string } & NormalizedRetrieveOptions {
    return {
      kbId: input['kbId' as keyof typeof input] as string ?? 'kb-1',
      retrievalMode: input.retrievalMode ?? 'vector',
      threshold: input.threshold ?? 0.6,
      rerank: input.rerank ?? true,
      stage1TopK: input.stage1TopK ?? 20,
      vectorTopK: input.vectorTopK ?? 20,
      keywordTopK: input.keywordTopK ?? 20,
      candidateLimit: input.candidateLimit ?? 40,
      finalTopK: input.finalTopK ?? 5,
      fusion: input.fusion ?? {
        method: 'rrf',
        rrfK: 60,
        vectorWeight: 1,
        keywordWeight: 1,
      },
      confidence: input.confidence ?? {
        keywordBm25SaturationScore: 12,
        minSupportingHits: 1,
      },
      rewrite: input.rewrite ?? false,
    };
  }

  it('persona stage2 默认遵守已保存的 rerank/finalTopK', () => {
    const result = (service as any).resolvePersonaStage2Options(
      [
        buildOptions({
          kbId: 'kb-1',
          retrievalMode: 'vector',
          rerank: false,
          finalTopK: 8,
          candidateLimit: 32,
        }),
        buildOptions({
          kbId: 'kb-2',
          retrievalMode: 'vector',
          rerank: false,
          finalTopK: 6,
          candidateLimit: 24,
        }),
      ],
      {},
    );

    expect(result).toMatchObject({
      retrievalMode: 'vector',
      rerank: false,
      finalTopK: 8,
      candidateLimit: 32,
    });
  });

  it('请求覆盖参数会覆盖 persona stage2 的默认聚合结果', () => {
    const result = (service as any).resolvePersonaStage2Options(
      [
        buildOptions({
          kbId: 'kb-1',
          retrievalMode: 'keyword',
          rerank: false,
          finalTopK: 3,
          candidateLimit: 10,
        }),
      ],
      {
        rerank: true,
        finalTopK: 4,
        candidateLimit: 18,
      },
    );

    expect(result).toMatchObject({
      retrievalMode: 'keyword',
      rerank: true,
      finalTopK: 4,
      candidateLimit: 18,
    });
  });

  it('只在模式混合时才把 persona retrievalMode 归并为 hybrid', () => {
    expect(
      (service as any).aggregateRetrievalMode(['vector', 'vector']),
    ).toBe('vector');
    expect(
      (service as any).aggregateRetrievalMode(['keyword', 'keyword']),
    ).toBe('keyword');
    expect(
      (service as any).aggregateRetrievalMode(['vector', 'hybrid']),
    ).toBe('hybrid');
  });
});
