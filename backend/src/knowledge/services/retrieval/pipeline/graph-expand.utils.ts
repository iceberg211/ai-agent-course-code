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

const GRAPH_SEMANTIC_SEPARATORS =
  /什么|怎么|如何|为什么|哪些|是否|可以|需要|相关|问题|关系|说明|内容|请问|请|应当|应该|应|必须|处理|进行|以及|并且|之后|以后|以前|其中|对于|关于|在|于|由|对|将|把|和|与|及|的|里|后|前|中/u;

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
  // 先按标点/空白切分，再按常见虚词拆出实体候选，避免长中文句只保留句首。
  const segments = normalized
    .split(/[^\u4e00-\u9fa5A-Za-z0-9_]+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates: string[] = [];
  for (const seg of segments) {
    if (/^[A-Za-z]/.test(seg)) {
      if (seg.length >= 2) candidates.push(seg.slice(0, 32));
      continue;
    }
    const semanticPieces = seg
      .split(GRAPH_SEMANTIC_SEPARATORS)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2);
    for (const piece of semanticPieces.length > 0 ? semanticPieces : [seg]) {
      if (piece.length <= 16) {
        candidates.push(piece);
        continue;
      }
      // 对仍然很长的专名或无标点文本覆盖句首、中部和句尾。
      const middleStart = Math.max(0, Math.floor((piece.length - 8) / 2));
      candidates.push(
        piece.slice(0, 8),
        piece.slice(middleStart, middleStart + 8),
        piece.slice(-8),
      );
    }
  }
  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  for (const item of sorted) {
    const term = item.trim();
    if (term.length < 2) continue;
    if (
      GRAPH_STOP_TERMS.has(term.toLowerCase()) ||
      GRAPH_STOP_TERMS.has(term)
    ) {
      continue;
    }
    terms.add(term);
    if (terms.size >= 8) break;
  }
  return Array.from(terms);
}
