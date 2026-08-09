export const DEFAULT_RAG_GRAPH_SCHEMA_VERSION = 'neo4j-graph-v1';
export const DEFAULT_RAG_GRAPH_EXTRACTOR_VERSION = 'graph-extractor-v1';

export type KnowledgeGraphNodeType =
  | 'Entity'
  | 'Event'
  | 'Topic'
  | 'Document'
  | 'Chunk';

export interface KnowledgeGraphChunkRef {
  id: string;
  chunkIndex: number;
  source: string;
  content?: string;
  category?: string | null;
  allowedUserIds?: string[] | null;
  allowedRoleIds?: string[] | null;
  allowedDepartmentIds?: string[] | null;
  securityLevel?: number | null;
  aclVersion?: number | null;
}

export interface KnowledgeGraphNodeRef {
  type: Exclude<KnowledgeGraphNodeType, 'Document' | 'Chunk'>;
  name: string;
  entityType?: string | null;
}

export interface ExtractedKnowledgeGraphNode extends KnowledgeGraphNodeRef {
  aliases?: string[];
  metadata?: Record<string, unknown>;
}

export interface ExtractedKnowledgeGraphEdge {
  source: KnowledgeGraphNodeRef;
  target: KnowledgeGraphNodeRef;
  relationType: string;
  relationLabel?: string | null;
  chunkId?: string | null;
  confidence?: number | null;
  evidenceText?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ExtractedKnowledgeGraph {
  nodes?: ExtractedKnowledgeGraphNode[];
  edges?: ExtractedKnowledgeGraphEdge[];
}

export interface BuildKnowledgeGraphUpsertPlanInput {
  documentId: string;
  chunks: KnowledgeGraphChunkRef[];
  extractedGraph?: ExtractedKnowledgeGraph;
  extractorVersion?: string;
  schemaVersion?: string;
}

export interface KnowledgeGraphNodePlan {
  nodeKey: string;
  nodeType: KnowledgeGraphNodeType;
  displayName: string;
  normalizedName: string;
  entityType: string | null;
  documentId: string | null;
  chunkId: string | null;
  aliases: string[];
  metadata: Record<string, unknown>;
}

export interface KnowledgeGraphEdgePlan {
  edgeKey: string;
  sourceNodeKey: string;
  targetNodeKey: string;
  relationType: string;
  relationLabel: string | null;
  documentId: string;
  chunkId: string | null;
  extractorVersion: string;
  schemaVersion: string;
  confidence: number;
  evidenceText: string | null;
  metadata: Record<string, unknown>;
}

export interface KnowledgeGraphUpsertPlan {
  documentId: string;
  extractorVersion: string;
  schemaVersion: string;
  nodes: KnowledgeGraphNodePlan[];
  edges: KnowledgeGraphEdgePlan[];
}

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

export interface Neo4jGraphRetrieveParams {
  knowledgeId: string;
  retrievalQuery: string;
  keywordTerms: string[];
  matchCount: number;
  graphMode?: 'neighbors' | 'path';
  graphMaxHops?: number;
  accessScope?: KnowledgeAccessScope;
  signal?: AbortSignal;
}

export interface Neo4jGraphSyncInput {
  documentId: string;
  knowledgeId: string;
  source: string;
  chunks: KnowledgeGraphChunkRef[];
  extractedGraph?: ExtractedKnowledgeGraph;
  isCurrentVersion?: boolean;
  isArchived?: boolean;
}

export interface Neo4jGraphSyncSummary {
  documentId: string;
  chunkCount: number;
  nodeCount: number;
  edgeCount: number;
}

export type Neo4jGraphSyncResult =
  | { status: 'indexed' }
  | { status: 'skipped' }
  | { status: 'failed'; errorMessage: string };
import type { KnowledgeAccessScope } from '@/knowledge/types/knowledge-content.types';
