import { calculateRagEvalMetrics } from '@/knowledge-content/evaluation/rag-eval.metrics';

describe('calculateRagEvalMetrics', () => {
  it('按稳定证据锚点计算 hit、MRR、rerank_retention 和 answer_point_coverage', () => {
    const metrics = calculateRagEvalMetrics([
      {
        case: {
          id: 'case-1',
          personaId: 'persona-1',
          query: '林黛玉的结局是什么？',
          expected_evidence_spans: [
            {
              documentId: 'doc-1',
              source: '红楼梦人物关系.md',
              quote: '林黛玉最终因病去世',
              answerPoint: '林黛玉病重后去世',
              snapshotChunkIds: ['chunk-old'],
            },
          ],
          snapshot_chunk_ids: ['chunk-old'],
          expected_answer_points: ['林黛玉病重后去世'],
          retrieval_config: {
            threshold: 0.6,
            stage1TopK: 3,
            finalTopK: 2,
            rerank: true,
          },
        },
        stage1: [
          {
            id: 'chunk-x',
            document_id: 'doc-x',
            content: '无关内容',
            source: 'x.md',
            chunk_index: 0,
            category: null,
            similarity: 0.7,
          },
          {
            id: 'chunk-new',
            document_id: 'doc-1',
            content: '这里写到林黛玉最终因病去世。',
            source: '红楼梦人物关系.md',
            chunk_index: 4,
            category: null,
            similarity: 0.6,
          },
        ],
        stage2: [
          {
            id: 'chunk-new',
            document_id: 'doc-1',
            content: '这里写到林黛玉最终因病去世，也能支撑林黛玉病重后去世。',
            source: '红楼梦人物关系.md',
            chunk_index: 4,
            category: null,
            similarity: 0.6,
          },
        ],
      },
    ]);

    expect(metrics.caseResults[0]).toMatchObject({
      stage1EvidenceHitAtK: 1,
      stage2EvidenceHitAtK: 1,
      mrr: 0.5,
      rerankRetention: 1,
      answerPointCoverage: 1,
    });
    expect(metrics.summary).toMatchObject({
      stage1EvidenceHitAtK: 1,
      stage2EvidenceHitAtK: 1,
      mrr: 0.5,
      rerankRetention: 1,
      answerPointCoverage: 1,
    });
  });
});
