import { VectorRetrieverService } from './vector-retriever.service';

describe('VectorRetrieverService', () => {
  it('调用 supabase match_knowledge RPC 返回数据', async () => {
    const rpcMock = jest.fn().mockResolvedValue({
      data: [{ id: 'chunk-1', content: 'test content' }],
      error: null,
    });
    const runtime = {
      withTransientRetry: jest.fn(
        <T>(_operation: string, fn: () => Promise<T>): Promise<T> => fn(),
      ),
      supabase: {
        rpc: rpcMock,
      },
    };

    const service = new VectorRetrieverService(runtime as any);
    const results = await service.retrieve({
      knowledgeId: 'kb-1',
      queryEmbedding: [0.1, 0.2],
      threshold: 0.5,
      matchCount: 5,
    });

    expect(rpcMock).toHaveBeenCalledWith('match_knowledge', {
      query_embedding: [0.1, 0.2],
      p_kb_id: 'kb-1',
      match_threshold: 0.5,
      match_count: 5,
    });
    expect(results).toEqual([
      {
        id: 'chunk-1',
        content: 'test content',
        retrieval_sources: ['vector'],
      },
    ]);
  });
});
