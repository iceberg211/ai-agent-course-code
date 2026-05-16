import { calculateRagEvalMetrics } from '@/knowledge-content/evaluation/rag-eval.metrics';
import { buildRagFixtureEvalInputs } from '@/knowledge-content/evaluation/rag-fixture-eval';

describe('buildRagFixtureEvalInputs', () => {
  it('基于 eval fixtures 生成离线评估输入和 trace', () => {
    const result = buildRagFixtureEvalInputs(
      [
        {
          id: 'legal_case_001',
          personaId: 'local-persona-after-import',
          query: '示例服务协议里协议终止后的试用数据应如何处理？',
          expected_evidence_spans: [
            {
              source: 'mock-legal-service-agreement.md',
              quote: '协议终止后，乙方应根据甲方要求导出、删除或清理相关试用数据',
              answerPoint: '根据甲方要求导出、删除或清理相关试用数据',
            },
          ],
          expected_answer_points: ['根据甲方要求导出、删除或清理相关试用数据'],
          retrieval_config: {
            finalTopK: 5,
          },
        },
      ],
      {
        fixtureDir: 'eval/fixtures',
      },
    );

    expect(result.caseInputs[0].stage1).toEqual([
      expect.objectContaining({
        id: 'fixture:mock-legal-service-agreement.md',
        source: 'mock-legal-service-agreement.md',
        content: expect.stringContaining(
          '协议终止后，乙方应根据甲方要求导出、删除或清理相关试用数据',
        ),
      }),
    ]);
    expect(result.cases[0]).toMatchObject({
      expectedEvidenceSpans: [
        expect.objectContaining({
          source: 'mock-legal-service-agreement.md',
          answerPoint: '根据甲方要求导出、删除或清理相关试用数据',
        }),
      ],
      expectedAnswerPoints: ['根据甲方要求导出、删除或清理相关试用数据'],
      retrievalQuery: '示例服务协议里协议终止后的试用数据应如何处理？',
      stage1ChunkIds: ['fixture:mock-legal-service-agreement.md'],
      stage2ChunkIds: ['fixture:mock-legal-service-agreement.md'],
      trace: [
        expect.objectContaining({
          keywordBackend: 'disabled',
          skippedChannels: ['vector', 'keyword', 'hyde', 'graph'],
          mergedResultCount: 1,
        }),
      ],
    });

    expect(calculateRagEvalMetrics(result.caseInputs).summary).toMatchObject({
      stage1_evidence_hit_at_k: 1,
      stage2_evidence_hit_at_k: 1,
      answer_point_coverage: 1,
    });
  });
});
