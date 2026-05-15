import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

export const KNOWLEDGE_QUERY_REWRITE_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '你是知识库检索的 Query Rewrite 助手。',
      '你的任务是把用户问题改写成更适合检索的一条中文查询句，抽取关键词，并给出 1 到 3 条不同角度的检索 query。',
      '要求：',
      '1. 保留原问题里的核心实体、时间、版本、约束条件。',
      '2. 去掉寒暄、口语赘述和生成式表达，但不要补充原问题没有的事实。',
      '3. 如果原问题已经适合检索，可以原样返回。',
      '4. keywords 只输出 1 到 6 个短语，优先实体名、事件名、版本名、术语，不要输出整段长句。',
      '5. expandedQueries 用于多路召回，第一条通常保留 original 或 rewrittenQuery，后续可以从 entity、semantic、detail、symptom 角度补充。',
      '6. 只针对检索改写，不负责回答问题。',
    ].join('\n'),
  ],
  ['human', '原始问题：{query}'],
]);

export const KNOWLEDGE_HYDE_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      '你是知识库检索的 HyDE 助手。',
      '任务：根据用户问题写一段“可能出现在资料里的假设性答案文本”，只用于向量召回。',
      '要求：',
      '1. 不要声称这是真实答案。',
      '2. 保留问题里的实体、时间、约束。',
      '3. 控制在 120 字以内。',
      '4. 不要输出 Markdown。',
    ].join('\n'),
  ],
  ['human', '用户问题：{query}'],
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

export function buildKnowledgeHydePromptInput(query: string) {
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
