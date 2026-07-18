import {
  evaluateRagAgentGoldenCase,
  parseRagAgentGoldenCases,
} from '@/agent/evaluation/rag-agent-golden-eval';
import type { RagWorkflowResult } from '@/agent/types/rag-workflow.types';

describe('rag-agent-golden-eval', () => {
  it('会同时检查真实 Agent 输出中的证据与答案要点', () => {
    const result = {
      answerText: '协议终止后，应根据甲方要求导出、删除或清理试用数据。',
      citations: [],
      state: {
        stopReason: 'single_hop_enough',
        topDocuments: [
          {
            id: 'chunk-1',
            source: 'contracts/mock-legal-service-agreement.md',
            content:
              '协议终止后，乙方应根据甲方要求导出、删除或清理相关试用数据。',
          },
        ],
        evidenceChunks: [],
      },
    } as unknown as RagWorkflowResult;

    const evaluation = evaluateRagAgentGoldenCase(
      {
        id: 'case-1',
        personaId: 'persona-1',
        query: '试用数据如何处理？',
        expected_evidence_spans: [
          {
            source: 'mock-legal-service-agreement.md',
            quote: '根据甲方要求导出、删除或清理相关试用数据',
          },
        ],
        expected_answer_points: ['根据甲方要求导出、删除或清理试用数据'],
      },
      result,
    );

    expect(evaluation).toMatchObject({
      passed: true,
      evidenceRecall: 1,
      answerPointRecall: 1,
      retrievedChunkCount: 1,
      stopReason: 'single_hop_enough',
    });
  });

  it('golden set 格式错误时会报告具体条目', () => {
    expect(() =>
      parseRagAgentGoldenCases([{ id: 'case-1', query: '问题' }]),
    ).toThrow('第 1 条缺少 personaId');
  });
});
