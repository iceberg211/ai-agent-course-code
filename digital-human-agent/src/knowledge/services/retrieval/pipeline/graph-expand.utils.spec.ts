import {
  countGraphChannelHits,
  extractGraphEntitySearchTerms,
  GRAPH_EXPAND_SKIP_HIT_THRESHOLD,
  shouldSkipGraphExpand,
} from '@/knowledge/services/retrieval/pipeline/graph-expand.utils';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

function chunk(
  id: string,
  partial?: Partial<KnowledgeChunk>,
): KnowledgeChunk {
  return {
    id,
    content: partial?.content ?? id,
    source: 't.md',
    chunk_index: 0,
    category: null,
    similarity: 0.5,
    ...partial,
  };
}

describe('graph-expand.utils golden', () => {
  it('G0: graphExpand=false 时跳过', () => {
    expect(
      shouldSkipGraphExpand({
        useGraphChannel: true,
        graphExpand: false,
        graphServiceEnabled: true,
        documents: [chunk('a')],
      }),
    ).toMatchObject({ skip: true, reason: expect.stringContaining('关闭') });
  });

  it('G0b: useGraphChannel=false 时跳过', () => {
    expect(
      shouldSkipGraphExpand({
        useGraphChannel: false,
        graphExpand: true,
        graphServiceEnabled: true,
        documents: [chunk('a')],
      }),
    ).toMatchObject({ skip: true });
  });

  it('G1: hybrid graph 命中不足阈值时允许 expand', () => {
    const docs = [
      chunk('v1', { retrieval_sources: ['vector'] }),
      chunk('g1', { retrieval_sources: ['graph'], graph_score: 0.8 }),
    ];
    expect(countGraphChannelHits(docs)).toBe(1);
    expect(
      shouldSkipGraphExpand({
        useGraphChannel: true,
        graphExpand: true,
        graphServiceEnabled: true,
        documents: docs,
      }).skip,
    ).toBe(false);
  });

  it('G3: hybrid graph 命中 >= 阈值时跳过二次 expand', () => {
    const docs = Array.from({ length: GRAPH_EXPAND_SKIP_HIT_THRESHOLD }, (_, i) =>
      chunk(`g${i}`, { retrieval_sources: ['graph'], graph_score: 0.9 }),
    );
    expect(
      shouldSkipGraphExpand({
        useGraphChannel: true,
        graphExpand: true,
        graphServiceEnabled: true,
        documents: docs,
      }),
    ).toMatchObject({
      skip: true,
      reason: expect.stringContaining('跳过二次扩展'),
    });
  });

  it('实体词提取按标点切分并过滤停用词', () => {
    const terms = extractGraphEntitySearchTerms(
      '系统定位、智能检索是什么关系？如何说明',
    );
    expect(terms.some((t) => t.includes('系统定位'))).toBe(true);
    expect(terms.some((t) => t.includes('智能检索'))).toBe(true);
    expect(terms).not.toContain('什么');
    expect(terms).not.toContain('如何');
  });
});

