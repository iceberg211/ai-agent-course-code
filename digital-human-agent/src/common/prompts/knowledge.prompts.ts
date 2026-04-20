import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

export const KNOWLEDGE_RERANK_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    '你是知识检索重排器。请根据用户问题评估每个候选片段的相关性分数。只返回 JSON 数组，不要 Markdown，不要额外解释。格式必须是 [{"index":0,"score":8.6}]，score 范围 0-10。',
  ],
  ['human', '{inputJson}'],
]);

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
