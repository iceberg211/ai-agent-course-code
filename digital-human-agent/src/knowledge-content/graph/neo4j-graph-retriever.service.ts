import { Injectable } from '@nestjs/common';
import { throwIfAborted } from '@/agent/agent.utils';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';
import { Neo4jGraphService } from '@/knowledge-content/graph/neo4j-graph.service';

export interface Neo4jGraphRetrieveParams {
  knowledgeId: string;
  retrievalQuery: string;
  keywordTerms: string[];
  matchCount: number;
  graphMode?: 'neighbors' | 'path';
  graphMaxHops?: number;
  signal?: AbortSignal;
}

interface Neo4jGraphEvidence {
  source: string;
  target: string;
  relationType: string;
  relationLabel: string | null;
  evidenceText: string | null;
  confidence: number;
}

interface Neo4jGraphRetrieveRow extends Record<string, unknown> {
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

@Injectable()
export class Neo4jGraphRetrieverService {
  constructor(private readonly neo4jGraphService: Neo4jGraphService) {}

  isEnabled(): boolean {
    return this.neo4jGraphService.isEnabled();
  }

  async retrieve(params: Neo4jGraphRetrieveParams): Promise<KnowledgeChunk[]> {
    if (!this.isEnabled()) return [];

    throwIfAborted(params.signal);
    const terms = buildSearchTerms(params.keywordTerms, params.retrievalQuery);
    if (terms.length === 0) return [];
    const maxHops = normalizeMaxHops(params.graphMaxHops);

    const rows = await this.neo4jGraphService.query<Neo4jGraphRetrieveRow>(
      params.graphMode === 'path' ? buildPathQuery(maxHops) : NEIGHBOR_QUERY,
      {
        knowledgeId: params.knowledgeId,
        terms,
        matchCount: Math.max(1, Math.trunc(params.matchCount)),
        maxHops,
      },
    );
    throwIfAborted(params.signal);

    return rows.map(toKnowledgeChunk);
  }
}

const NEIGHBOR_QUERY = `
        MATCH (c:KnowledgeChunk {knowledgeId: $knowledgeId})
        WHERE c.enabled = true
        OPTIONAL MATCH (source:GraphNode)-[rel]->(target:GraphNode)
        WHERE rel.chunkId = c.id
        WITH c, collect(
          CASE WHEN rel IS NULL THEN null ELSE {
            source: source.displayName,
            target: target.displayName,
            relationType: coalesce(rel.relationType, type(rel)),
            relationLabel: rel.relationLabel,
            evidenceText: rel.evidenceText,
            confidence: coalesce(rel.confidence, 0.5)
          } END
        ) AS rawEvidence
        WITH c, [item IN rawEvidence WHERE item IS NOT NULL] AS evidence
        WITH
          c,
          evidence,
          size([
            term IN $terms
            WHERE
              toLower(coalesce(c.content, '')) CONTAINS term
              OR toLower(coalesce(c.source, '')) CONTAINS term
              OR toLower(coalesce(c.category, '')) CONTAINS term
          ]) AS chunkMatches,
          size([
            item IN evidence
            WHERE any(term IN $terms WHERE
              toLower(
                coalesce(item.source, '') + ' ' +
                coalesce(item.target, '') + ' ' +
                coalesce(item.relationType, '') + ' ' +
                coalesce(item.relationLabel, '') + ' ' +
                coalesce(item.evidenceText, '')
              ) CONTAINS term
            )
          ]) AS graphMatches,
          reduce(score = 0.0, item IN evidence | score + coalesce(toFloat(item.confidence), 0.5)) AS confidenceSum
        WHERE chunkMatches > 0 OR graphMatches > 0
        RETURN
          c.id AS id,
          c.documentId AS document_id,
          c.knowledgeId AS knowledge_base_id,
          c.content AS content,
          c.source AS source,
          c.chunkIndex AS chunk_index,
          c.category AS category,
          (chunkMatches * 0.2 + graphMatches * 0.6 + confidenceSum * 0.05) AS graph_score,
          evidence[..5] AS graph_evidence
        ORDER BY graph_score DESC, c.chunkIndex ASC
        LIMIT toInteger($matchCount)
`;

function buildPathQuery(maxHops: number): string {
  return `
        MATCH (c:KnowledgeChunk {knowledgeId: $knowledgeId})
        WHERE c.enabled = true
        OPTIONAL MATCH (source:GraphNode)-[rel]->(target:GraphNode)
        WHERE rel.chunkId = c.id
        WITH c, collect(
          CASE WHEN rel IS NULL THEN null ELSE {
            source: source.displayName,
            target: target.displayName,
            relationType: coalesce(rel.relationType, type(rel)),
            relationLabel: rel.relationLabel,
            evidenceText: rel.evidenceText,
            confidence: coalesce(rel.confidence, 0.5)
          } END
        ) AS rawEvidence
        WITH c, [item IN rawEvidence WHERE item IS NOT NULL] AS evidence
        OPTIONAL MATCH path = (:GraphNode)-[pathRels*1..${maxHops}]-(:GraphNode)
        WHERE any(pathRel IN pathRels WHERE pathRel.chunkId = c.id)
        WITH c, evidence, collect(path) AS paths
        WITH
          c,
          evidence,
          size([
            term IN $terms
            WHERE
              toLower(coalesce(c.content, '')) CONTAINS term
              OR toLower(coalesce(c.source, '')) CONTAINS term
              OR toLower(coalesce(c.category, '')) CONTAINS term
          ]) AS chunkMatches,
          size([
            item IN evidence
            WHERE any(term IN $terms WHERE
              toLower(
                coalesce(item.source, '') + ' ' +
                coalesce(item.target, '') + ' ' +
                coalesce(item.relationType, '') + ' ' +
                coalesce(item.relationLabel, '') + ' ' +
                coalesce(item.evidenceText, '')
              ) CONTAINS term
            )
          ]) AS graphMatches,
          size([
            currentPath IN paths
            WHERE any(term IN $terms WHERE
              any(pathNode IN nodes(currentPath) WHERE
                toLower(
                  coalesce(pathNode.displayName, '') + ' ' +
                  coalesce(pathNode.normalizedName, '') + ' ' +
                  coalesce(pathNode.entityType, '')
                ) CONTAINS term
              )
              OR any(pathRel IN relationships(currentPath) WHERE
                toLower(
                  coalesce(pathRel.relationType, '') + ' ' +
                  coalesce(pathRel.relationLabel, '') + ' ' +
                  coalesce(pathRel.evidenceText, '')
                ) CONTAINS term
              )
            )
          ]) AS pathMatches,
          reduce(score = 0.0, item IN evidence | score + coalesce(toFloat(item.confidence), 0.5)) AS confidenceSum
        WHERE chunkMatches > 0 OR graphMatches > 0 OR pathMatches > 0
        RETURN
          c.id AS id,
          c.documentId AS document_id,
          c.knowledgeId AS knowledge_base_id,
          c.content AS content,
          c.source AS source,
          c.chunkIndex AS chunk_index,
          c.category AS category,
          (chunkMatches * 0.2 + graphMatches * 0.6 + pathMatches * 0.8 + confidenceSum * 0.05) AS graph_score,
          evidence[..5] AS graph_evidence
        ORDER BY graph_score DESC, c.chunkIndex ASC
        LIMIT toInteger($matchCount)
      `;
}

function buildSearchTerms(
  keywordTerms: string[],
  retrievalQuery: string,
): string[] {
  return Array.from(
    new Set(
      [...keywordTerms, retrievalQuery]
        .map((term) => term.replace(/\s+/g, ' ').trim().toLowerCase())
        .filter((term) => term.length > 0)
        .slice(0, 8),
    ),
  );
}

function toKnowledgeChunk(row: Neo4jGraphRetrieveRow): KnowledgeChunk {
  const graphScore = normalizeScore(row.graph_score);

  return {
    id: row.id,
    document_id: row.document_id,
    knowledge_base_id: row.knowledge_base_id,
    content: row.content,
    source: row.source,
    chunk_index: Number(row.chunk_index),
    category: row.category,
    similarity: 0,
    graph_score: graphScore,
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

function normalizeMaxHops(value: number | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(3, Math.max(1, Math.trunc(parsed)));
}
