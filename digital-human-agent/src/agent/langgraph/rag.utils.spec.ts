import {
  capCandidateDocuments,
  mergeEvidenceChunks,
} from '@/agent/langgraph/rag.utils';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

describe('rag.utils', () => {
  it('capCandidateDocuments 按分数截断候选池', () => {
    const docs = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      content: `c${i}`,
      source: 'a.md',
      chunk_index: i,
      category: null,
      similarity: i * 0.1,
      hybrid_score: i,
    }));
    const capped = capCandidateDocuments(docs as never, 3);
    expect(capped).toHaveLength(3);
    expect(capped.map((d) => d.id)).toEqual(['c4', 'c3', 'c2']);
  });

  it('合并重复证据时保留图谱分数和图谱证据', () => {
    const baseChunk = {
      id: 'chunk-1',
      content: '合同约定甲方在验收后七日内付款。',
      source: 'contract.md',
      chunk_index: 1,
      category: 'contract',
      similarity: 0.72,
      hybrid_score: 0.02,
      retrieval_sources: ['vector'],
    } satisfies KnowledgeChunk;
    const graphChunk = {
      ...baseChunk,
      similarity: 0.3,
      graph_score: 1.4,
      retrieval_sources: ['graph'],
      graph_evidence: [
        {
          source: '甲方',
          target: '验收',
          relationType: 'MENTIONS',
          relationLabel: '提及',
          evidenceText: '甲方应在验收后七日内付款。',
          confidence: 0.91,
        },
      ],
    } satisfies KnowledgeChunk;

    const result = mergeEvidenceChunks([baseChunk], [graphChunk]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'chunk-1',
      graph_score: 1.4,
      retrieval_sources: ['vector', 'graph'],
      graph_evidence: [
        expect.objectContaining({
          source: '甲方',
          target: '验收',
          relationType: 'MENTIONS',
        }),
      ],
    });
  });
});
