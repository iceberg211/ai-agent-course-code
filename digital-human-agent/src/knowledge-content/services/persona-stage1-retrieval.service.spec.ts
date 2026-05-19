import { PersonaStage1RetrievalService } from '@/knowledge-content/services/persona-stage1-retrieval.service';

describe('PersonaStage1RetrievalService', () => {
  const retrievalQueries = [
    {
      index: 0,
      query: '验收付款关系',
      keywords: ['验收', '付款'],
      angle: 'original' as const,
    },
  ];

  function createService() {
    const runtime = {
      toBoundedNumber: jest.fn(
        (raw: unknown, defaultValue: number, min: number, max: number) => {
          const value = Number(raw);
          if (!Number.isFinite(value)) return defaultValue;
          return Math.min(max, Math.max(min, value));
        },
      ),
    };
    const personaKnowledgeConfigService = {
      listMountedKnowledgeConfigs: jest.fn(),
    };
    const stage1RetrievalService = {
      retrieveForKnowledge: jest.fn(),
    };

    const service = new PersonaStage1RetrievalService(
      runtime as never,
      personaKnowledgeConfigService as never,
      stage1RetrievalService as never,
    );

    return {
      service,
      runtime,
      personaKnowledgeConfigService,
      stage1RetrievalService,
    };
  }

  it('会按 persona 挂载知识库并发拉取 stage1 结果，同时限制并发数', async () => {
    const originalConcurrency = process.env.RAG_PERSONA_KB_CONCURRENCY;
    process.env.RAG_PERSONA_KB_CONCURRENCY = '2';
    const {
      service,
      personaKnowledgeConfigService,
      stage1RetrievalService,
    } = createService();

    personaKnowledgeConfigService.listMountedKnowledgeConfigs.mockResolvedValue([
      { knowledgeId: 'kb-1', threshold: 0.6, stage1TopK: 10 },
      { knowledgeId: 'kb-2', threshold: 0.6, stage1TopK: 10 },
      { knowledgeId: 'kb-3', threshold: 0.6, stage1TopK: 10 },
    ]);

    let inFlight = 0;
    let maxInFlight = 0;
    stage1RetrievalService.retrieveForKnowledge.mockImplementation(
      async ({ knowledgeId }: { knowledgeId: string }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return {
          chunks: [
            {
              id: `chunk-${knowledgeId}`,
              content: `知识库 ${knowledgeId} 结果`,
              source: `${knowledgeId}.md`,
              chunk_index: 0,
              category: null,
              similarity: 0.8,
              hybrid_score:
                knowledgeId === 'kb-1'
                  ? 0.03
                  : knowledgeId === 'kb-2'
                    ? 0.02
                    : 0.01,
            },
          ],
          trace: [
            {
              knowledgeId,
              queryIndex: 0,
              query: '验收付款关系',
              keywords: ['验收', '付款'],
              angle: 'original' as const,
              vectorBackend: 'pgvector' as const,
              keywordBackend: 'pg' as const,
              graphBackend: 'disabled' as const,
              vectorResultCount: 1,
              keywordResultCount: 1,
              mergedResultCount: 1,
              fallbackToPg: false,
              skippedChannels: [],
            },
          ],
        };
      },
    );

    try {
      const result = await service.retrieve({
        personaId: 'persona-1',
        retrievalQueries,
        channels: {
          useVector: true,
          useKeyword: true,
          useGraph: false,
          useExactPhrase: false,
        },
      });

      expect(maxInFlight).toBeLessThanOrEqual(2);
      expect(stage1RetrievalService.retrieveForKnowledge).toHaveBeenCalledTimes(
        3,
      );
      expect(result.knowledgeCount).toBe(3);
      expect(result.chunks.map((chunk) => chunk.id)).toEqual([
        'chunk-kb-1',
        'chunk-kb-2',
        'chunk-kb-3',
      ]);
      expect(result.trace).toHaveLength(3);
    } finally {
      if (originalConcurrency === undefined) {
        delete process.env.RAG_PERSONA_KB_CONCURRENCY;
      } else {
        process.env.RAG_PERSONA_KB_CONCURRENCY = originalConcurrency;
      }
    }
  });

  it('单个知识库出现非瞬时错误时会降级跳过，不影响其他知识库结果', async () => {
    const {
      service,
      personaKnowledgeConfigService,
      stage1RetrievalService,
    } = createService();

    personaKnowledgeConfigService.listMountedKnowledgeConfigs.mockResolvedValue([
      { knowledgeId: 'kb-1', threshold: 0.6, stage1TopK: 10 },
      { knowledgeId: 'kb-2', threshold: 0.6, stage1TopK: 10 },
    ]);

    stage1RetrievalService.retrieveForKnowledge
      .mockResolvedValueOnce({
        chunks: [
          {
            id: 'chunk-kb-1',
            content: '正常结果',
            source: 'kb-1.md',
            chunk_index: 0,
            category: null,
            similarity: 0.9,
            hybrid_score: 0.03,
          },
        ],
        trace: [],
      })
      .mockRejectedValueOnce(new Error('invalid response payload'));

    const result = await service.retrieve({
      personaId: 'persona-1',
      retrievalQueries,
      channels: {
        useVector: true,
        useKeyword: true,
        useGraph: false,
        useExactPhrase: false,
      },
    });

    expect(result.knowledgeCount).toBe(2);
    expect(result.chunks).toEqual([
      expect.objectContaining({
        id: 'chunk-kb-1',
      }),
    ]);
  });
});
