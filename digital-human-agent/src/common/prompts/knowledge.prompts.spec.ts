import {
  buildKnowledgeRerankPromptInput,
  KNOWLEDGE_RERANK_PROMPT,
} from '@/common/prompts/knowledge.prompts';

describe('KNOWLEDGE_RERANK_PROMPT', () => {
  it('可以正常格式化带 JSON 示例的 system prompt', async () => {
    const messages = await KNOWLEDGE_RERANK_PROMPT.formatMessages(
      buildKnowledgeRerankPromptInput('系统的核心功能是什么？', [
        {
          id: 'chunk-1',
          content: '这是用于测试的知识片段。',
          source: 'test.md',
          chunk_index: 0,
          category: '测试',
          similarity: 0.88,
        },
      ]),
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain('[{"index":0,"score":8.6}]');
    expect(messages[1].content).toContain('"query": "系统的核心功能是什么？"');
  });
});
