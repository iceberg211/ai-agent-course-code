import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';
import { PROMPT_REGISTRY } from '@/common/prompts/prompt.registry';

export const KNOWLEDGE_QUERY_REWRITE_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', PROMPT_REGISTRY.knowledgeQueryRewrite.system],
  ['human', PROMPT_REGISTRY.knowledgeQueryRewrite.human],
]);

export const KNOWLEDGE_HYDE_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', PROMPT_REGISTRY.knowledgeHyde.system],
  ['human', PROMPT_REGISTRY.knowledgeHyde.human],
]);

export const KNOWLEDGE_CONTEXTUAL_RETRIEVAL_PROMPT =
  ChatPromptTemplate.fromMessages([
    ['system', PROMPT_REGISTRY.knowledgeContextualRetrieval.system],
    ['human', PROMPT_REGISTRY.knowledgeContextualRetrieval.human],
  ]);

export const KNOWLEDGE_RERANK_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', PROMPT_REGISTRY.knowledgeRerank.system],
  ['human', PROMPT_REGISTRY.knowledgeRerank.human],
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

export function buildKnowledgeContextualRetrievalPromptInput(input: {
  filename: string;
  documentContent: string;
  chunkContent: string;
}) {
  return {
    filename: input.filename,
    documentExcerpt: input.documentContent.slice(0, 4000),
    chunkContent: input.chunkContent.slice(0, 1200),
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
