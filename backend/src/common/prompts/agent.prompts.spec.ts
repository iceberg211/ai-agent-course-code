import {
  formatKnowledgeBlock,
  MULTI_HOP_PLANNER_PROMPT,
  RAG_EVIDENCE_EVALUATOR_PROMPT,
  RAG_ROUTE_PROMPT,
  trimHistoryAgainstRollingSummary,
} from '@/common/prompts/agent.prompts';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

describe('agent.prompts', () => {
  it('有会话摘要时裁短 history', () => {
    const history = [
      { role: 'user', content: '1', turnId: 't1' },
      { role: 'assistant', content: 'a1', turnId: 't1' },
      { role: 'user', content: '2', turnId: 't2' },
      { role: 'assistant', content: 'a2', turnId: 't2' },
      { role: 'user', content: '3', turnId: 't3' },
      { role: 'assistant', content: 'a3', turnId: 't3' },
    ] as never[];
    const trimmed = trimHistoryAgainstRollingSummary(
      history,
      '会话摘要：讨论过验收\n最近对话：...',
      2,
    );
    expect(trimmed).toHaveLength(4);
    expect(trimmed[0].content).toBe('2');
    expect(trimmed.at(-1)?.content).toBe('a3');
  });

  it('无会话摘要时保留完整 history', () => {
    const history = [
      { role: 'user', content: '1', turnId: 't1' },
      { role: 'assistant', content: 'a1', turnId: 't1' },
    ] as never[];
    expect(
      trimHistoryAgainstRollingSummary(history, '当前任务背景：法务', 2),
    ).toHaveLength(2);
  });

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

  it('结构化输出 prompt 显式声明 JSON，兼容 qwen-max response_format 要求', async () => {
    const routeMessages = await RAG_ROUTE_PROMPT.formatMessages({
      question: '系统定位和智能检索是什么关系？',
    });
    const plannerMessages = await MULTI_HOP_PLANNER_PROMPT.formatMessages({
      question: '系统定位和智能检索是什么关系？',
    });
    const evaluatorMessages = await RAG_EVIDENCE_EVALUATOR_PROMPT.formatMessages({
      question: '系统定位和智能检索是什么关系？',
      currentHop: 1,
      maxHops: 1,
      remainingSubQuestionCount: 0,
      localEvidenceBlock: '证据',
      webEvidenceBlock: '无',
    });

    for (const messages of [
      routeMessages,
      plannerMessages,
      evaluatorMessages,
    ]) {
      const content = messages
        .map((message) => String(message.content))
        .join('\n');
      expect(content).toContain('JSON');
    }
  });
});
