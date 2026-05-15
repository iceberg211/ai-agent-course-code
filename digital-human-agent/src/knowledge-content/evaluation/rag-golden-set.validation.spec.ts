import { validateRagGoldenSet } from '@/knowledge-content/evaluation/rag-golden-set.validation';

describe('validateRagGoldenSet', () => {
  it('接受 source + quote + answerPoint 作为稳定证据锚点，并允许没有 snapshot chunk id', () => {
    expect(
      validateRagGoldenSet([
        {
          id: 'legal_case_001',
          personaId: 'local-persona-after-import',
          query: '协议终止后的试用数据应如何处理？',
          expected_evidence_spans: [
            {
              source: 'mock-legal-service-agreement.md',
              quote: '协议终止后，乙方应根据甲方要求导出、删除或清理相关试用数据',
              answerPoint: '根据甲方要求导出、删除或清理相关试用数据',
            },
          ],
          expected_answer_points: ['根据甲方要求导出、删除或清理相关试用数据'],
        },
      ]),
    ).toEqual([]);
  });

  it('拒绝占位值和只依赖 snapshot chunk id 的证据', () => {
    expect(
      validateRagGoldenSet([
        {
          id: 'replace-with-case-id',
          personaId: 'replace-with-local-persona-id',
          query: '试用数据什么时候删除？',
          expected_evidence_spans: [
            {
              documentId: 'replace-with-document-id',
              source: '',
              quote: '',
              answerPoint: '试用结束后七日内删除试用数据',
              snapshotChunkIds: ['replace-with-current-snapshot-chunk-id'],
            },
          ],
          snapshot_chunk_ids: ['replace-with-current-snapshot-chunk-id'],
          expected_answer_points: [],
        },
      ]),
    ).toEqual([
      'case[0].id 不能是占位值',
      'case[0].personaId 不能是占位值',
      'case[0].expected_answer_points 至少需要 1 条答案要点',
      'case[0].expected_evidence_spans[0].documentId 不能是占位值',
      'case[0].expected_evidence_spans[0] 需要 documentId 或 source 之一',
      'case[0].expected_evidence_spans[0].quote 不能为空',
      'case[0].expected_evidence_spans[0].snapshotChunkIds 只能作为快照提示，不能使用占位值',
      'case[0].snapshot_chunk_ids 只能作为快照提示，不能使用占位值',
    ]);
  });

  it('开启 fixture 校验时会确认 source 文件存在且包含 quote', () => {
    expect(
      validateRagGoldenSet(
        [
          {
            id: 'legal_case_001',
            personaId: 'local-persona-after-import',
            query: '协议终止后的试用数据应如何处理？',
            expected_evidence_spans: [
              {
                source: 'mock-legal-service-agreement.md',
                quote: '协议终止后，乙方应根据甲方要求导出、删除或清理相关试用数据',
                answerPoint: '根据甲方要求导出、删除或清理相关试用数据',
              },
            ],
            expected_answer_points: ['根据甲方要求导出、删除或清理相关试用数据'],
          },
        ],
        {
          fixtureDir: 'eval/fixtures',
        },
      ),
    ).toEqual([]);

    expect(
      validateRagGoldenSet(
        [
          {
            id: 'legal_case_002',
            personaId: 'local-persona-after-import',
            query: '试用数据什么时候删除？',
            expected_evidence_spans: [
              {
                source: 'mock-legal-service-agreement.md',
                quote: '这段证据并不存在',
                answerPoint: '根据甲方要求导出、删除或清理相关试用数据',
              },
            ],
            expected_answer_points: ['根据甲方要求导出、删除或清理相关试用数据'],
          },
        ],
        {
          fixtureDir: 'eval/fixtures',
        },
      ),
    ).toEqual([
      'case[0].expected_evidence_spans[0].quote 不在 fixture source 中',
    ]);
  });
});
