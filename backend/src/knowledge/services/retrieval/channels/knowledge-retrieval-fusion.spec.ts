import {
  fuseMultiChannelResultsWithTrace,
} from '@/knowledge/services/retrieval/channels/knowledge-retrieval-fusion';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

function chunk(input: Partial<KnowledgeChunk> & { id: string }): KnowledgeChunk {
  return {
    content: `${input.id} content`,
    source: 'test.md',
    chunk_index: 0,
    category: null,
    similarity: 0,
    ...input,
  };
}

describe('knowledge retrieval fusion', () => {
  it('RRF 只按通道内排名融合，单通道高原始分不会压过多通道共同命中', () => {
    const shared = chunk({
      id: 'shared',
      similarity: 0.2,
      keyword_score: 1,
      retrieval_sources: ['vector', 'keyword'],
    });
    const keywordOnly = chunk({
      id: 'keyword-only',
      keyword_score: 9999,
      retrieval_sources: ['keyword'],
    });

    const channels = new Map<string, KnowledgeChunk[]>();
    channels.set('vector', [shared]);
    channels.set('keyword', [keywordOnly, shared]);

    const result = fuseMultiChannelResultsWithTrace(channels, {
      globalRetrievalLimit: 10,
      rrfK: 60,
    });

    expect(result.chunks.map((item) => item.id)).toEqual([
      'shared',
      'keyword-only',
    ]);
    expect(result.trace[0]).toMatchObject({
      chunkId: 'shared',
      retrievalSources: ['vector', 'keyword'],
      channelRanks: {
        vector: 1,
        keyword: 2,
      },
      rawScores: {
        vector: 0.2,
        keyword: 1,
      },
    });
    expect(result.trace[1]).toMatchObject({
      chunkId: 'keyword-only',
      rawScores: {
        keyword: 9999,
      },
    });
  });
});

