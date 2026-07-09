import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

const GRAPH_STOP_TERMS = new Set([
  '什么',
  '怎么',
  '如何',
  '为什么',
  '哪些',
  '是否',
  '可以',
  '需要',
  '相关',
  '问题',
  '关系',
  '说明',
  '内容',
  'the',
  'and',
  'for',
  'with',
]);

/** hybrid 已有足够 graph 证据时跳过 expand 的阈值 */
export const GRAPH_EXPAND_SKIP_HIT_THRESHOLD = 3;

export function countGraphChannelHits(chunks: KnowledgeChunk[]): number {
  return chunks.filter(
    (doc) =>
      doc.retrieval_sources?.includes('graph') ||
      (doc.graph_score ?? 0) > 0 ||
      (doc.graph_evidence?.length ?? 0) > 0,
  ).length;
}

/**
 * 是否应跳过 graph expand（纯函数，便于 golden 断言）。
 */
export function shouldSkipGraphExpand(input: {
  useGraphChannel: boolean;
  graphExpand: boolean;
  graphServiceEnabled: boolean;
  documents: KnowledgeChunk[];
}): { skip: boolean; reason?: string } {
  if (!input.graphExpand) {
    return { skip: true, reason: 'profile/policy 关闭 graphExpand' };
  }
  if (!input.useGraphChannel) {
    return { skip: true, reason: '未开启 graph 检索通道' };
  }
  if (!input.graphServiceEnabled) {
    return { skip: true, reason: '图谱服务未启用' };
  }
  if (input.documents.length === 0) {
    return { skip: true, reason: '无召回文档，跳过 expand' };
  }
  const hits = countGraphChannelHits(input.documents);
  if (hits >= GRAPH_EXPAND_SKIP_HIT_THRESHOLD) {
    return {
      skip: true,
      reason: `hybrid 已命中 ${hits} 条图谱证据，跳过二次扩展`,
    };
  }
  return { skip: false };
}

export function extractGraphEntitySearchTerms(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const terms = new Set<string>();
  const matches =
    normalized.match(
      /[\u4e00-\u9fa5]{2,16}|[A-Za-z][A-Za-z0-9_-]{1,31}/g,
    ) ?? [];
  const sorted = [...matches].sort((a, b) => b.length - a.length);
  for (const item of sorted) {
    const term = item.trim();
    if (term.length < 2) continue;
    if (GRAPH_STOP_TERMS.has(term.toLowerCase()) || GRAPH_STOP_TERMS.has(term)) {
      continue;
    }
    terms.add(term);
    if (terms.size >= 5) break;
  }
  return Array.from(terms);
}
