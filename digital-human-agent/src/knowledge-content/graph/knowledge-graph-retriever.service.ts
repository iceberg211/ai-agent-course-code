import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  DEFAULT_RAG_GRAPH_EXTRACTOR_VERSION,
  DEFAULT_RAG_GRAPH_SCHEMA_VERSION,
} from '@/knowledge-content/graph/knowledge-graph-upsert-plan';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

export interface KnowledgeGraphRetrieveParams {
  knowledgeId: string;
  retrievalQuery: string;
  keywordTerms: string[];
  matchCount: number;
  graphMode?: 'neighbors' | 'path';
  graphMaxHops?: number;
}

interface KnowledgeGraphEvidence {
  source: string;
  target: string;
  relationType: string;
  relationLabel: string | null;
  evidenceText: string | null;
  confidence: number;
}

interface KnowledgeGraphRetrieveRow {
  id: string;
  document_id: string;
  knowledge_base_id: string;
  content: string;
  source: string;
  chunk_index: number;
  category: string | null;
  graph_score: number | string | null;
  graph_evidence: unknown;
}

@Injectable()
export class KnowledgeGraphRetrieverService {
  constructor(private readonly dataSource: DataSource) {}

  async retrieve(
    params: KnowledgeGraphRetrieveParams,
  ): Promise<KnowledgeChunk[]> {
    const patterns = buildSearchPatterns(
      params.keywordTerms,
      params.retrievalQuery,
    );
    if (patterns.length === 0) return [];

    const maxHops = normalizeMaxHops(params.graphMaxHops);
    const rows =
      params.graphMode === 'path' && maxHops > 1
        ? await this.queryPathRows(params, patterns, maxHops)
        : await this.queryNeighborRows(params, patterns);

    return rows.map(toKnowledgeChunk);
  }

  private async queryNeighborRows(
    params: KnowledgeGraphRetrieveParams,
    patterns: string[],
  ): Promise<KnowledgeGraphRetrieveRow[]> {
    return (await this.dataSource.query(
      `
        WITH matched_edges AS (
          SELECT
            e.id,
            e.chunk_id,
            e.relation_type,
            e.relation_label,
            e.confidence,
            e.evidence_text,
            sn.display_name AS source_name,
            tn.display_name AS target_name,
            (
              e.confidence
              + CASE WHEN sn.normalized_name ILIKE ANY($2::text[]) THEN 0.2 ELSE 0 END
              + CASE WHEN tn.normalized_name ILIKE ANY($2::text[]) THEN 0.2 ELSE 0 END
              + CASE WHEN e.relation_type ILIKE ANY($2::text[]) THEN 0.1 ELSE 0 END
              + CASE WHEN COALESCE(e.evidence_text, '') ILIKE ANY($2::text[]) THEN 0.1 ELSE 0 END
            ) AS score
          FROM rag_graph_edge e
          JOIN rag_graph_index_status s ON s.document_id = e.document_id
          JOIN knowledge_document d ON d.id = e.document_id
          JOIN rag_graph_node sn ON sn.id = e.source_node_id
          JOIN rag_graph_node tn ON tn.id = e.target_node_id
          WHERE d.knowledge_base_id = $1
            AND d.status = 'completed'
            AND s.status = 'indexed'
            AND s.extractor_version = $4
            AND s.schema_version = $5
            AND e.extractor_version = $4
            AND e.schema_version = $5
            AND e.chunk_id IS NOT NULL
            AND (
              sn.normalized_name ILIKE ANY($2::text[])
              OR tn.normalized_name ILIKE ANY($2::text[])
              OR e.relation_type ILIKE ANY($2::text[])
              OR COALESCE(e.relation_label, '') ILIKE ANY($2::text[])
              OR COALESCE(e.evidence_text, '') ILIKE ANY($2::text[])
            )
        )
        SELECT
          c.id,
          c.document_id,
          d.knowledge_base_id,
          c.content,
          c.source,
          c.chunk_index,
          c.category,
          MAX(me.score) AS graph_score,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'source', me.source_name,
                'target', me.target_name,
                'relationType', me.relation_type,
                'relationLabel', me.relation_label,
                'evidenceText', me.evidence_text,
                'confidence', me.confidence
              )
              ORDER BY me.score DESC, me.confidence DESC
            ),
            '[]'::jsonb
          ) AS graph_evidence
        FROM matched_edges me
        JOIN knowledge_chunk c ON c.id = me.chunk_id
        JOIN knowledge_document d ON d.id = c.document_id
        WHERE c.enabled = true
        GROUP BY
          c.id,
          c.document_id,
          d.knowledge_base_id,
          c.content,
          c.source,
          c.chunk_index,
          c.category
        ORDER BY graph_score DESC, c.chunk_index ASC
        LIMIT $3
      `,
      [
        params.knowledgeId,
        patterns,
        Math.max(1, Math.trunc(params.matchCount)),
        currentExtractorVersion(),
        currentSchemaVersion(),
      ],
    )) as KnowledgeGraphRetrieveRow[];
  }

  private async queryPathRows(
    params: KnowledgeGraphRetrieveParams,
    patterns: string[],
    maxHops: number,
  ): Promise<KnowledgeGraphRetrieveRow[]> {
    return (await this.dataSource.query(
      `
        WITH RECURSIVE path_edges AS (
          SELECT
            e.id,
            e.chunk_id,
            e.relation_type,
            e.relation_label,
            e.confidence,
            e.evidence_text,
            e.document_id,
            e.source_node_id,
            e.target_node_id,
            sn.display_name AS source_name,
            tn.display_name AS target_name,
            ARRAY[e.id] AS path_ids,
            1 AS depth,
            (
              e.confidence
              + CASE WHEN sn.normalized_name ILIKE ANY($2::text[]) THEN 0.2 ELSE 0 END
              + CASE WHEN tn.normalized_name ILIKE ANY($2::text[]) THEN 0.2 ELSE 0 END
              + CASE WHEN e.relation_type ILIKE ANY($2::text[]) THEN 0.1 ELSE 0 END
              + CASE WHEN COALESCE(e.evidence_text, '') ILIKE ANY($2::text[]) THEN 0.1 ELSE 0 END
            ) AS score
          FROM rag_graph_edge e
          JOIN rag_graph_index_status s ON s.document_id = e.document_id
          JOIN knowledge_document d ON d.id = e.document_id
          JOIN rag_graph_node sn ON sn.id = e.source_node_id
          JOIN rag_graph_node tn ON tn.id = e.target_node_id
          WHERE d.knowledge_base_id = $1
            AND d.status = 'completed'
            AND s.status = 'indexed'
            AND s.extractor_version = $4
            AND s.schema_version = $5
            AND e.extractor_version = $4
            AND e.schema_version = $5
            AND e.chunk_id IS NOT NULL
            AND (
              sn.normalized_name ILIKE ANY($2::text[])
              OR tn.normalized_name ILIKE ANY($2::text[])
              OR e.relation_type ILIKE ANY($2::text[])
              OR COALESCE(e.relation_label, '') ILIKE ANY($2::text[])
              OR COALESCE(e.evidence_text, '') ILIKE ANY($2::text[])
            )

          UNION ALL

          SELECT
            e.id,
            e.chunk_id,
            e.relation_type,
            e.relation_label,
            e.confidence,
            e.evidence_text,
            e.document_id,
            e.source_node_id,
            e.target_node_id,
            sn.display_name AS source_name,
            tn.display_name AS target_name,
            path_edges.path_ids || e.id,
            path_edges.depth + 1,
            (path_edges.score * 0.85 + e.confidence * 0.15) AS score
          FROM path_edges
          JOIN rag_graph_edge e ON e.document_id = path_edges.document_id
          JOIN rag_graph_node sn ON sn.id = e.source_node_id
          JOIN rag_graph_node tn ON tn.id = e.target_node_id
          WHERE path_edges.depth < $6
            AND e.extractor_version = $4
            AND e.schema_version = $5
            AND e.chunk_id IS NOT NULL
            AND NOT e.id = ANY(path_edges.path_ids)
            AND (
              e.source_node_id IN (path_edges.source_node_id, path_edges.target_node_id)
              OR e.target_node_id IN (path_edges.source_node_id, path_edges.target_node_id)
            )
        )
        SELECT
          c.id,
          c.document_id,
          d.knowledge_base_id,
          c.content,
          c.source,
          c.chunk_index,
          c.category,
          MAX(pe.score) AS graph_score,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'source', pe.source_name,
                'target', pe.target_name,
                'relationType', pe.relation_type,
                'relationLabel', pe.relation_label,
                'evidenceText', pe.evidence_text,
                'confidence', pe.confidence
              )
              ORDER BY pe.depth ASC, pe.score DESC, pe.confidence DESC
            ),
            '[]'::jsonb
          ) AS graph_evidence
        FROM path_edges pe
        JOIN knowledge_chunk c ON c.id = pe.chunk_id
        JOIN knowledge_document d ON d.id = c.document_id
        WHERE c.enabled = true
        GROUP BY
          c.id,
          c.document_id,
          d.knowledge_base_id,
          c.content,
          c.source,
          c.chunk_index,
          c.category
        ORDER BY graph_score DESC, c.chunk_index ASC
        LIMIT $3
      `,
      [
        params.knowledgeId,
        patterns,
        Math.max(1, Math.trunc(params.matchCount)),
        currentExtractorVersion(),
        currentSchemaVersion(),
        maxHops,
      ],
    )) as KnowledgeGraphRetrieveRow[];
  }
}

function toKnowledgeChunk(row: KnowledgeGraphRetrieveRow): KnowledgeChunk {
  const graphScore = normalizeScore(row.graph_score);
  return {
    id: row.id,
    document_id: row.document_id,
    knowledge_base_id: row.knowledge_base_id,
    content: row.content,
    source: row.source,
    chunk_index: row.chunk_index,
    category: row.category,
    similarity: graphScore,
    graph_score: graphScore,
    hybrid_score: graphScore,
    retrieval_sources: ['graph'],
    graph_evidence: normalizeEvidence(row.graph_evidence),
  };
}

function buildSearchPatterns(keywordTerms: string[], retrievalQuery: string): string[] {
  return Array.from(
    new Set(
      [...keywordTerms, retrievalQuery]
        .map((term) => term.replace(/[%_]/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((term) => `%${term}%`),
    ),
  );
}

function normalizeScore(value: number | string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function normalizeMaxHops(value: number | undefined): number {
  const parsed = Number(value ?? 2);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(3, Math.max(1, Math.trunc(parsed)));
}

function normalizeEvidence(value: unknown): KnowledgeGraphEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isKnowledgeGraphEvidence);
}

function isKnowledgeGraphEvidence(value: unknown): value is KnowledgeGraphEvidence {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.source === 'string' &&
    typeof record.target === 'string' &&
    typeof record.relationType === 'string'
  );
}

function currentExtractorVersion(): string {
  return (
    process.env.RAG_GRAPH_EXTRACTOR_VERSION?.trim() ||
    DEFAULT_RAG_GRAPH_EXTRACTOR_VERSION
  );
}

function currentSchemaVersion(): string {
  return (
    process.env.GRAPH_INDEX_VERSION?.trim() || DEFAULT_RAG_GRAPH_SCHEMA_VERSION
  );
}
