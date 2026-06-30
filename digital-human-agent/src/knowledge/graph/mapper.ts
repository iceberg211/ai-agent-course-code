import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import {
  Neo4jGraphEvidence,
  Neo4jGraphRetrieveRow,
} from '@/knowledge/types/knowledge-graph.types';

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

export function toNeo4jKnowledgeChunk(
  row: Neo4jGraphRetrieveRow,
): KnowledgeChunk {
  return {
    id: row.id,
    document_id: row.document_id,
    knowledge_base_id: row.knowledge_base_id,
    content: row.content,
    source: row.source,
    chunk_index: Number(row.chunk_index),
    category: row.category,
    similarity: 0,
    graph_score: Number(row.graph_score) || 0,
    retrieval_sources: ['graph'],
    graph_evidence: normalizeEvidence(row.graph_evidence),
  };
}

function normalizeEvidence(value: unknown): Neo4jGraphEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isNeo4jGraphEvidence);
}

function isNeo4jGraphEvidence(value: unknown): value is Neo4jGraphEvidence {
  if (value === null || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.source === 'string' &&
    typeof item.target === 'string' &&
    typeof item.relationType === 'string'
  );
}

export function extractMarkdownHeadings(content: string) {
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
    .filter((heading): heading is { level: number; name: string; evidenceText: string } => Boolean(heading));
}

export function normalizeDisplayName(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function extractPartyTerms(content: string): string[] {
  return PARTY_TERMS.filter((term) => content.includes(term));
}

export function buildEvidenceExcerpt(content: string, term: string): string {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  const index = normalizedContent.indexOf(term);
  if (index < 0) return normalizedContent.slice(0, 160);

  const start = Math.max(0, index - 50);
  const end = Math.min(normalizedContent.length, index + term.length + 90);
  return normalizedContent.slice(start, end);
}
