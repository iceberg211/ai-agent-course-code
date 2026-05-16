import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

export interface Neo4jGraphEvidence {
  source: string;
  target: string;
  relationType: string;
  relationLabel: string | null;
  evidenceText: string | null;
  confidence: number;
}

export interface Neo4jGraphRetrieveRow extends Record<string, unknown> {
  id: string;
  document_id: string;
  knowledge_base_id: string;
  content: string;
  source: string;
  chunk_index: number | string;
  category: string | null;
  graph_score: number | string | null;
  graph_evidence: unknown;
}

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
    graph_score: normalizeScore(row.graph_score),
    retrieval_sources: ['graph'],
    graph_evidence: normalizeEvidence(row.graph_evidence),
  };
}

function normalizeScore(value: number | string | null): number {
  const score = Number(value);
  return Number.isFinite(score) ? score : 0;
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
