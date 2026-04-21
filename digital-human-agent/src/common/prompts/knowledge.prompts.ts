import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

export const KNOWLEDGE_QUERY_REWRITE_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '你是知识库检索的 Query Rewrite 助手。',
      '你的任务是把用户问题改写成更适合检索的一条中文查询句，并抽取一组适合关键词检索的短语。',
      '要求：',
      '1. 保留原问题里的核心实体、时间、版本、约束条件。',
      '2. 去掉寒暄、口语赘述和生成式表达，但不要补充原问题没有的事实。',
      '3. 如果原问题已经适合检索，可以原样返回。',
      '4. keywords 只输出 1 到 6 个短语，优先实体名、事件名、版本名、术语，不要输出整段长句。',
      '5. 只针对检索改写，不负责回答问题。',
    ].join('\n'),
  ],
  ['human', '原始问题：{query}'],
]);

export const KNOWLEDGE_RERANK_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    '你是知识检索重排器。请根据用户问题评估每个候选片段的相关性分数。只返回 JSON 数组，不要 Markdown，不要额外解释。格式必须是 [{{"index":0,"score":8.6}}]，score 范围 0-10。',
  ],
  ['human', '{inputJson}'],
]);

export function buildKnowledgeQueryRewritePromptInput(query: string) {
  return {
    query,
  };
}

export function buildKnowledgeRerankPromptInput(
  query: string,
  candidates: KnowledgeChunk[],
) {
  return {
    inputJson: JSON.stringify(
      {
        query,
        candidates: candidates.map((chunk, index) => ({
          index,
          source: chunk.source,
          chunkIndex: chunk.chunk_index,
          similarity: chunk.similarity,
          content: chunk.content.slice(0, 1200),
        })),
      },
      null,
      2,
    ),
  };
}
