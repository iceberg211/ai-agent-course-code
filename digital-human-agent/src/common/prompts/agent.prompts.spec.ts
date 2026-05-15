import { formatKnowledgeBlock } from '@/common/prompts/agent.prompts';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

describe('agent.prompts', () => {
  it('formatKnowledgeBlock 会把图谱检索证据格式化为 LLM 可读上下文', () => {
    const chunks: KnowledgeChunk[] = [
      {
        id: 'chunk-1',
        content: '合同约定甲方在验收后七日内付款。',
        source: 'contracts/service.md',
        chunk_index: 3,
        category: 'contract',
        similarity: 0.82,
        retrieval_sources: ['graph'],
        graph_evidence: [
          {
            source: '甲方',
            target: '验收',
            relationType: 'MENTIONS',
            relationLabel: '提及',
            evidenceText: '甲方应在验收后七日内完成付款。',
            confidence: 0.91,
          },
        ],
      },
    ];

    expect(formatKnowledgeBlock(chunks)).toContain(
      '图谱证据：\n- 甲方 --提及--> 验收（类型：MENTIONS，置信度：0.91，证据：甲方应在验收后七日内完成付款。）',
    );
  });

  it('formatKnowledgeBlock 没有图谱证据时保持原有知识块格式', () => {
    const chunks: KnowledgeChunk[] = [
      {
        id: 'chunk-1',
        content: '普通知识内容',
        source: 'docs/basic.md',
        chunk_index: 1,
        category: null,
        similarity: 0.8,
      },
    ];

    expect(formatKnowledgeBlock(chunks)).toBe(
      '[来源: docs/basic.md, 段落 1]\n普通知识内容',
    );
  });
});
