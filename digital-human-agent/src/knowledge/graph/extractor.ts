import {
  type KnowledgeGraphChunkRef,
  type ExtractedKnowledgeGraphNode,
  type ExtractedKnowledgeGraphEdge,
  type ExtractedKnowledgeGraph,
} from '@/knowledge/types/knowledge-graph.types';
import {
  extractMarkdownHeadings,
  normalizeDisplayName,
  extractPartyTerms,
  buildEvidenceExcerpt,
} from './mapper';

export function extractGraphFromChunks(
  chunks: KnowledgeGraphChunkRef[],
): ExtractedKnowledgeGraph {
  const nodes = new Map<string, ExtractedKnowledgeGraphNode>();
  const edges = new Map<string, ExtractedKnowledgeGraphEdge>();

  for (const chunk of chunks) {
    const content = chunk.content ?? '';
    const headings = extractMarkdownHeadings(content);

    for (const heading of headings) {
      nodes.set(
        `Topic::${normalizeDisplayName(heading.name)}`,
        { type: 'Topic', name: heading.name }
      );
    }

    // 添加等级依赖关系
    const stack: { level: number; name: string; evidenceText: string }[] = [];
    for (const heading of headings) {
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }

      const parent = stack[stack.length - 1];
      if (parent) {
        const edge = {
          source: { type: 'Topic' as const, name: parent.name },
          target: { type: 'Topic' as const, name: heading.name },
          relationType: 'HAS_SUBTOPIC',
          relationLabel: '包含子主题',
          chunkId: chunk.id,
          confidence: 0.85,
          evidenceText: `${parent.evidenceText}\n${heading.evidenceText}`,
          metadata: {
            parentLevel: parent.level,
            childLevel: heading.level,
            extractor: 'markdown-heading-rule',
          },
        };
        edges.set(
          `Topic::${normalizeDisplayName(parent.name)}->HAS_SUBTOPIC->Topic::${normalizeDisplayName(heading.name)}->${chunk.id}`,
          edge
        );
      }
      stack.push(heading);
    }

    const topic = headings[headings.length - 1];
    if (!topic) continue;

    for (const partyName of extractPartyTerms(content)) {
      const partyNode = {
        type: 'Entity' as const,
        name: partyName,
        entityType: 'Party',
      };
      const topicNode = {
        type: 'Topic' as const,
        name: topic.name,
      };
      nodes.set(`Entity:Party:${normalizeDisplayName(partyName)}`, partyNode);
      nodes.set(`Topic::${normalizeDisplayName(topic.name)}`, topicNode);

      const edge = {
        source: partyNode,
        target: topicNode,
        relationType: 'MENTIONS',
        relationLabel: '提及',
        chunkId: chunk.id,
        confidence: 0.65,
        evidenceText: buildEvidenceExcerpt(content, partyName),
        metadata: {
          extractor: 'markdown-party-rule',
          source: chunk.source,
        },
      };
      edges.set(
        `Entity:Party:${normalizeDisplayName(partyName)}->MENTIONS->Topic::${normalizeDisplayName(topic.name)}->${chunk.id}`,
        edge
      );
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}
