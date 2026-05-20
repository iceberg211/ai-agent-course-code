import { createRerankNode } from '@/agent/langgraph/nodes/evaluation/rerank.node';

describe('createRerankNode', () => {
  const documents = [
    {
      id: 'chunk-1',
      content: '第一段',
      source: 'demo.md',
      chunk_index: 0,
      category: null,
      similarity: 0.82,
    },
    {
      id: 'chunk-2',
      content: '第二段',
      source: 'demo.md',
      chunk_index: 1,
      category: null,
      similarity: 0.91,
    },
  ];

  it('会对累计 documents 做统一 rerank，并产出 topDocuments', async () => {
    const rerankerService = {
      rerank: jest.fn().mockResolvedValue([documents[1], documents[0]]),
    };
    const node = createRerankNode(rerankerService as never);

    const update = await node(
      {
        question: '当前问题',
        documents,
      } as never,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(rerankerService.rerank).toHaveBeenCalledWith(
      '当前问题',
      documents,
      5,
      expect.any(AbortSignal),
    );
    expect(update).toEqual({
      topDocuments: [documents[1], documents[0]],
      evidenceChunks: [documents[1], documents[0]],
    });
  });

  it('没有 documents 时不会调用 reranker', async () => {
    const rerankerService = {
      rerank: jest.fn(),
    };
    const node = createRerankNode(rerankerService as never);

    const update = await node(
      {
        question: '当前问题',
        documents: [],
      } as never,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(rerankerService.rerank).not.toHaveBeenCalled();
    expect(update).toEqual({
      topDocuments: [],
      evidenceChunks: [],
    });
  });

  it('如果 state 中有动态配置的 rerankLimit，则会优先使用它', async () => {
    const rerankerService = {
      rerank: jest.fn().mockResolvedValue([documents[1]]),
    };
    const node = createRerankNode(rerankerService as never);

    const update = await node(
      {
        question: '当前问题',
        documents,
        rerankLimit: 10,
      } as never,
      {
        configurable: {
          workflowInput: {
            signal: new AbortController().signal,
          },
        },
      } as never,
    );

    expect(rerankerService.rerank).toHaveBeenCalledWith(
      '当前问题',
      documents,
      10,
      expect.any(AbortSignal),
    );
    expect(update).toEqual({
      topDocuments: [documents[1]],
      evidenceChunks: [documents[1]],
    });
  });
});

