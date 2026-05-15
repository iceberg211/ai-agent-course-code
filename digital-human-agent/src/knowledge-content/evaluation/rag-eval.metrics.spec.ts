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
    expect(metrics.caseResults[0]).toMatchObject({
      stage1_evidence_hit_at_k: 1,
      stage2_evidence_hit_at_k: 1,
      rerank_retention: 1,
      answer_point_coverage: 1,
    });
    expect(metrics.summary).toMatchObject({
      stage1_evidence_hit_at_k: 1,
      stage2_evidence_hit_at_k: 1,
      rerank_retention: 1,
      answer_point_coverage: 1,
    });
  });

  it('没有稳定 documentId 时，可以用 source + quote 作为证据锚点', () => {
    const metrics = calculateRagEvalMetrics([
      {
        case: {
          id: 'case-source-only',
          personaId: 'persona-1',
          query: '试用数据什么时候删除？',
          expected_evidence_spans: [
            {
              source: 'mock-legal-service-agreement.md',
              quote: '试用期结束后，乙方应在七日内删除甲方试用数据',
              answerPoint: '试用结束后七日内删除试用数据',
            },
          ],
          expected_answer_points: ['试用结束后七日内删除试用数据'],
        },
        stage1: [
          {
            id: 'chunk-1',
            document_id: 'doc-current-snapshot',
            content: '试用期结束后，乙方应在七日内删除甲方试用数据。',
            source: 'mock-legal-service-agreement.md',
            chunk_index: 0,
            category: null,
            similarity: 0.7,
          },
        ],
        stage2: [
          {
            id: 'chunk-1',
            document_id: 'doc-current-snapshot',
            content:
              '试用期结束后，乙方应在七日内删除甲方试用数据，试用结束后七日内删除试用数据。',
            source: 'mock-legal-service-agreement.md',
            chunk_index: 0,
            category: null,
            similarity: 0.7,
          },
        ],
      },
    ]);

    expect(metrics.caseResults[0]).toMatchObject({
      stage1EvidenceHitAtK: 1,
      stage2EvidenceHitAtK: 1,
      mrr: 1,
      answerPointCoverage: 1,
    });
  });

  it('rerank_retention 只统计 Stage1 已命中且 Stage2 仍保留的证据', () => {
    const metrics = calculateRagEvalMetrics([
      {
        case: {
          id: 'case-retention',
          personaId: 'persona-1',
          query: '试用期和付款方式分别是什么？',
          expected_evidence_spans: [
            {
              source: 'contract.md',
              quote: '试用期结束后七日内删除数据',
              answerPoint: '试用数据七日内删除',
            },
            {
              source: 'contract.md',
              quote: '服务费应在每月五日前支付',
              answerPoint: '每月五日前支付服务费',
            },
          ],
          expected_answer_points: [
            '试用数据七日内删除',
            '每月五日前支付服务费',
          ],
        },
        stage1: [
          {
            id: 'chunk-a',
            content: '试用期结束后七日内删除数据。',
            source: 'contract.md',
            chunk_index: 1,
            category: null,
            similarity: 0.8,
          },
        ],
        stage2: [
          {
            id: 'chunk-b',
            content: '服务费应在每月五日前支付。',
            source: 'contract.md',
            chunk_index: 2,
            category: null,
            similarity: 0.7,
          },
        ],
      },
    ]);

    expect(metrics.caseResults[0]).toMatchObject({
      stage1EvidenceHitAtK: 0.5,
      stage2EvidenceHitAtK: 0.5,
      rerankRetention: 0,
    });
  });

  it('answer_point_coverage 按最终 Stage2 覆盖的答案点比例计算', () => {
    const metrics = calculateRagEvalMetrics([
      {
        case: {
          id: 'case-answer-points',
          personaId: 'persona-1',
          query: '试用数据删除和付款期限分别是什么？',
          expected_evidence_spans: [
            {
              source: 'contract.md',
              quote: '试用期结束后七日内删除数据',
              answerPoint: '试用数据七日内删除',
            },
            {
              source: 'contract.md',
              quote: '服务费应在每月五日前支付',
              answerPoint: '每月五日前支付服务费',
            },
          ],
          expected_answer_points: [
            '试用数据七日内删除',
            '每月五日前支付服务费',
          ],
        },
        stage1: [
          {
            id: 'chunk-a',
            content: '试用期结束后七日内删除数据。',
            source: 'contract.md',
            chunk_index: 1,
            category: null,
            similarity: 0.8,
          },
          {
            id: 'chunk-b',
            content: '服务费应在每月五日前支付。',
            source: 'contract.md',
            chunk_index: 2,
            category: null,
            similarity: 0.7,
          },
        ],
        stage2: [
          {
            id: 'chunk-a',
            content: '试用期结束后七日内删除数据，可概括为试用数据七日内删除。',
            source: 'contract.md',
            chunk_index: 1,
            category: null,
            similarity: 0.8,
          },
        ],
      },
    ]);

    expect(metrics.caseResults[0]).toMatchObject({
      stage1EvidenceHitAtK: 1,
      stage2EvidenceHitAtK: 0.5,
      answerPointCoverage: 0.5,
      answer_point_coverage: 0.5,
    });
  });
});
