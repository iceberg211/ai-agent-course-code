import { KnowledgeVectorRetrieverService } from '@/knowledge-content/services/knowledge-vector-retriever.service';

describe('KnowledgeVectorRetrieverService', () => {
  it('传入 AbortSignal 时会交给 Supabase RPC 查询', async () => {
    const signal = new AbortController().signal;
    type RpcResult = {
      data: unknown[];
      error: null;
    };
    const abortSignal = jest
      .fn<Promise<RpcResult>, [AbortSignal]>()
      .mockResolvedValue({
        data: [],
        error: null,
      });
    const runtime = {
      withTransientRetry: jest.fn(
        <T>(_operation: string, fn: () => Promise<T>): Promise<T> => fn(),
      ),
      supabase: {
        rpc: jest.fn().mockReturnValue({
          abortSignal,
        }),
      },
    };
    const service = new KnowledgeVectorRetrieverService(runtime as never);

    await service.retrieve({
      knowledgeId: 'kb-1',
      queryEmbedding: [0.1, 0.2],
      threshold: 0.6,
      matchCount: 5,
      signal,
    });

    expect(runtime.supabase.rpc).toHaveBeenCalledWith('match_knowledge', {
      query_embedding: [0.1, 0.2],
      p_kb_id: 'kb-1',
      match_threshold: 0.6,
      match_count: 5,
    });
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });
});
