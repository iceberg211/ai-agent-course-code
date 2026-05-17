import { KnowledgeHybridRetrieverService } from '@/knowledge-content/services/knowledge-hybrid-retriever.service';

describe('KnowledgeHybridRetrieverService', () => {
  it('会把向量检索和关键词检索的结果做融合排序', async () => {
    const vectorRetriever = {
      retrieve: jest.fn().mockResolvedValue([
        {
          id: 'a',
          content: '向量命中的 chunk A',
          source: 'a.md',
          chunk_index: 0,
          category: null,
          similarity: 0.93,
          retrieval_sources: ['vector'],
        },
        {
          id: 'b',
          content: '向量命中的 chunk B',
          source: 'b.md',
          chunk_index: 1,
          category: null,
          similarity: 0.84,
          retrieval_sources: ['vector'],
        },
      ]),
    };

    const keywordRetriever = {
      retrieve: jest.fn().mockResolvedValue({
        backend: 'elastic',
        fallbackToPg: false,
        chunks: [
          {
            id: 'b',
            content: '关键词命中的 chunk B',
            source: 'b.md',
            chunk_index: 1,
            category: null,
            similarity: 0,
            keyword_score: 18,
            retrieval_sources: ['keyword'],
          },
          {
            id: 'c',
            content: '关键词命中的 chunk C',
            source: 'c.md',
            chunk_index: 2,
            category: null,
            similarity: 0,
            keyword_score: 12,
            retrieval_sources: ['keyword'],
          },
        ],
      }),
    };

    const service = new KnowledgeHybridRetrieverService(
      vectorRetriever as never,
      keywordRetriever as never,
    );

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      queryEmbedding: [0.1, 0.2],
      retrievalQuery: '雁门关事件主谋',
      keywordTerms: ['雁门关事件', '主谋'],
      threshold: 0.6,
      matchCount: 5,
    });

    expect(result.chunks.map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(result.chunks[0].retrieval_sources).toEqual(['vector', 'keyword']);
    expect(result.chunks[0].hybrid_score).toBeGreaterThan(
      result.chunks[1].hybrid_score ?? 0,
    );
    expect(result.keywordBackend).toBe('elastic');
    expect(result.vectorResultCount).toBe(2);
    expect(result.keywordResultCount).toBe(2);
  });

  it('useKeyword=false 时不会调用关键词检索，并把 keywordBackend 标记为 disabled', async () => {
    const vectorRetriever = {
      retrieve: jest.fn().mockResolvedValue([
        {
          id: 'a',
          content: '只走向量命中的 chunk A',
          source: 'a.md',
          chunk_index: 0,
          category: null,
          similarity: 0.93,
        },
      ]),
    };

    const keywordRetriever = {
      retrieve: jest.fn(),
    };

    const service = new KnowledgeHybridRetrieverService(
      vectorRetriever as never,
      keywordRetriever as never,
    );

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      queryEmbedding: [0.1, 0.2],
      retrievalQuery: '雁门关事件主谋',
      keywordTerms: ['雁门关事件', '主谋'],
      threshold: 0.6,
      matchCount: 5,
      useKeyword: false,
    });

    expect(vectorRetriever.retrieve).toHaveBeenCalledTimes(1);
    expect(keywordRetriever.retrieve).not.toHaveBeenCalled();
    expect(result.chunks.map((item) => item.id)).toEqual(['a']);
    expect(result.keywordBackend).toBe('disabled');
    expect(result.keywordResultCount).toBe(0);
    expect(result.skippedChannels).toEqual(
      expect.arrayContaining(['keyword']),
    );
  });

  it('useVector=false 时不会调用向量检索，并记录 vector 跳过通道', async () => {
    const vectorRetriever = {
      retrieve: jest.fn(),
    };
    const keywordRetriever = {
      retrieve: jest.fn().mockResolvedValue({
        backend: 'pg',
        fallbackToPg: false,
        chunks: [
          {
            id: 'k',
            content: '只走关键词命中的 chunk',
            source: 'k.md',
            chunk_index: 0,
            category: null,
            similarity: 0,
            keyword_score: 10,
          },
        ],
      }),
    };

    const service = new KnowledgeHybridRetrieverService(
      vectorRetriever as never,
      keywordRetriever as never,
    );

    const result = await service.retrieve({
      knowledgeId: 'kb-1',
      queryEmbedding: [0.1, 0.2],
      retrievalQuery: '删除时限',
      keywordTerms: ['删除时限'],
      threshold: 0.6,
      matchCount: 5,
      useVector: false,
      useKeyword: true,
    });

    expect(vectorRetriever.retrieve).not.toHaveBeenCalled();
    expect(keywordRetriever.retrieve).toHaveBeenCalledTimes(1);
    expect(result.vectorResultCount).toBe(0);
    expect(result.keywordResultCount).toBe(1);
    expect(result.skippedChannels).toEqual(
      expect.arrayContaining(['vector']),
    );
  });

  it('useExactPhrase=true 时会把精确短语策略传给关键词检索', async () => {
    const vectorRetriever = {
      retrieve: jest.fn().mockResolvedValue([]),
    };
    const keywordRetriever = {
      retrieve: jest.fn().mockResolvedValue({
        backend: 'elastic',
        fallbackToPg: false,
        chunks: [],
      }),
    };
    const service = new KnowledgeHybridRetrieverService(
      vectorRetriever as never,
      keywordRetriever as never,
    );

    await service.retrieve({
      knowledgeId: 'kb-1',
      queryEmbedding: [0.1, 0.2],
      retrievalQuery: '合同 第七条',
      keywordTerms: ['合同', '第七条'],
      threshold: 0.6,
      matchCount: 5,
      useExactPhrase: true,
    });

    expect(keywordRetriever.retrieve).toHaveBeenCalledWith({
      knowledgeId: 'kb-1',
      terms: ['合同', '第七条'],
      matchCount: 5,
      useExactPhrase: true,
    });
  });

  it('会把 AbortSignal 继续传给向量和关键词检索', async () => {
    const signal = new AbortController().signal;
    const vectorRetriever = {
      retrieve: jest.fn().mockResolvedValue([]),
    };
    const keywordRetriever = {
      retrieve: jest.fn().mockResolvedValue({
        backend: 'pg',
        fallbackToPg: false,
        chunks: [],
      }),
    };
    const service = new KnowledgeHybridRetrieverService(
      vectorRetriever as never,
      keywordRetriever as never,
    );

    await service.retrieve({
      knowledgeId: 'kb-1',
      queryEmbedding: [0.1, 0.2],
      retrievalQuery: '删除时限',
      keywordTerms: ['删除时限'],
      threshold: 0.6,
      matchCount: 5,
      signal,
    });

    expect(vectorRetriever.retrieve).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ signal }),
    );
    expect(keywordRetriever.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
  });
});
