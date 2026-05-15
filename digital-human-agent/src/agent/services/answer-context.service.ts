import type { RetrievalStrategy } from '@/agent/types/rag-workflow.types';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

export function prepareLocalChunksForAnswer(
  chunks: KnowledgeChunk[],
  question: string,
  strategy: RetrievalStrategy,
): KnowledgeChunk[] {
  const compressed = strategy.contextCompression
    ? chunks.map((chunk) => ({
        ...chunk,
        content: compressChunkForQuestion(chunk.content, question),
      }))
    : chunks;

  return strategy.lostInMiddle
    ? applyLostInTheMiddleOrdering(compressed)
    : compressed;
}

export function applyLostInTheMiddleOrdering(
  chunks: KnowledgeChunk[],
): KnowledgeChunk[] {
  if (chunks.length <= 2) return chunks;

  const reordered: KnowledgeChunk[] = [];
  let left = 0;
  let right = chunks.length - 1;

  while (left <= right) {
    reordered.push(chunks[left]);
    if (left !== right) {
      reordered.push(chunks[right]);
    }
    left += 1;
    right -= 1;
  }

  return reordered;
}

export function compressChunkForQuestion(content: string, question: string) {
  const keywords = extractKeywords(question);
  if (keywords.length === 0 || content.length <= 600) {
    return content;
  }

  const sentences = content
    .split(/(?<=[。！？；.!?;])|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const matched = sentences.filter((sentence) =>
    keywords.some((keyword) => sentence.includes(keyword)),
  );

  const selected = matched.length > 0 ? matched : sentences.slice(0, 2);
  const compressed = selected.join('\n').slice(0, 600);
  return compressed || content.slice(0, 600);
}

function extractKeywords(question: string): string[] {
  return Array.from(
    new Set(
      question
        .replace(/[，。！？；：、“”‘’（）()【】\[\],.!?;:]/g, ' ')
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2),
    ),
  ).slice(0, 8);
}
