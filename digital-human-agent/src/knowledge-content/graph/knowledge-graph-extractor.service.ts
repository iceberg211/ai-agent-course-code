import { Injectable } from '@nestjs/common';
import type {
  ExtractedKnowledgeGraph,
  ExtractedKnowledgeGraphEdge,
  ExtractedKnowledgeGraphNode,
  KnowledgeGraphChunkRef,
  KnowledgeGraphNodeRef,
} from '@/knowledge-content/graph/knowledge-graph-upsert-plan';

export interface ExtractKnowledgeGraphInput {
  documentId: string;
  chunks: KnowledgeGraphChunkRef[];
}

interface MarkdownHeading {
  level: number;
  name: string;
  evidenceText: string;
}

const PARTY_TERMS = [
  '甲方',
  '乙方',
  '丙方',
  '丁方',
  '发包方',
  '承包方',
  '客户',
  '供应商',
  '服务商',
];

@Injectable()
export class KnowledgeGraphExtractorService {
  async extract(
    input: ExtractKnowledgeGraphInput,
  ): Promise<ExtractedKnowledgeGraph> {
    const nodes = new Map<string, ExtractedKnowledgeGraphNode>();
    const edges = new Map<string, ExtractedKnowledgeGraphEdge>();

    for (const chunk of input.chunks) {
      const content = chunk.content ?? '';
      const headings = extractMarkdownHeadings(content);

      for (const heading of headings) {
        addNode(nodes, { type: 'Topic', name: heading.name });
      }
      addHeadingHierarchyEdges(edges, headings, chunk.id);

      const topic = headings[headings.length - 1];
      if (!topic) continue;

      for (const partyName of extractPartyTerms(content)) {
        const partyNode = {
          type: 'Entity',
          name: partyName,
          entityType: 'Party',
        } satisfies ExtractedKnowledgeGraphNode;
        const topicNode = {
          type: 'Topic',
          name: topic.name,
        } satisfies ExtractedKnowledgeGraphNode;
        addNode(nodes, partyNode);
        addNode(nodes, topicNode);
        addEdge(edges, {
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
        });
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
    };
  }
}

function extractMarkdownHeadings(content: string): MarkdownHeading[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
      if (!match) return null;
      const name = normalizeDisplayName(match[2]);
      if (!name) return null;
      return {
        level: match[1].length,
        name,
        evidenceText: line,
      };
    })
    .filter((heading): heading is MarkdownHeading => Boolean(heading));
}

function addHeadingHierarchyEdges(
  edges: Map<string, ExtractedKnowledgeGraphEdge>,
  headings: MarkdownHeading[],
  chunkId: string,
): void {
  const stack: MarkdownHeading[] = [];

  for (const heading of headings) {
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      addEdge(edges, {
        source: { type: 'Topic', name: parent.name },
        target: { type: 'Topic', name: heading.name },
        relationType: 'HAS_SUBTOPIC',
        relationLabel: '包含子主题',
        chunkId,
        confidence: 0.85,
        evidenceText: `${parent.evidenceText}\n${heading.evidenceText}`,
        metadata: {
          parentLevel: parent.level,
          childLevel: heading.level,
          extractor: 'markdown-heading-rule',
        },
      });
    }

    stack.push(heading);
  }
}

function extractPartyTerms(content: string): string[] {
  return PARTY_TERMS.filter((term) => content.includes(term));
}

function addNode(
  nodes: Map<string, ExtractedKnowledgeGraphNode>,
  node: ExtractedKnowledgeGraphNode,
): void {
  nodes.set(nodeKey(node), node);
}

function addEdge(
  edges: Map<string, ExtractedKnowledgeGraphEdge>,
  edge: ExtractedKnowledgeGraphEdge,
): void {
  edges.set(edgeKey(edge), edge);
}

function nodeKey(node: KnowledgeGraphNodeRef): string {
  return [node.type, node.entityType ?? '', normalizeDisplayName(node.name)]
    .filter(Boolean)
    .join(':');
}

function edgeKey(edge: ExtractedKnowledgeGraphEdge): string {
  return [
    nodeKey(edge.source),
    edge.relationType,
    nodeKey(edge.target),
    edge.chunkId ?? '',
  ].join('->');
}

function normalizeDisplayName(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildEvidenceExcerpt(content: string, term: string): string {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  const index = normalizedContent.indexOf(term);
  if (index < 0) return normalizedContent.slice(0, 160);

  const start = Math.max(0, index - 50);
  const end = Math.min(normalizedContent.length, index + term.length + 90);
  return normalizedContent.slice(start, end);
}
