export const DEFAULT_RAG_GRAPH_SCHEMA_VERSION = 'graph-schema-v1';
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

export function buildKnowledgeGraphUpsertPlan(
  input: BuildKnowledgeGraphUpsertPlanInput,
): KnowledgeGraphUpsertPlan {
  const extractorVersion =
    input.extractorVersion?.trim() || DEFAULT_RAG_GRAPH_EXTRACTOR_VERSION;
  const schemaVersion =
    input.schemaVersion?.trim() || DEFAULT_RAG_GRAPH_SCHEMA_VERSION;
  const nodes = new Map<string, KnowledgeGraphNodePlan>();
  const edges = new Map<string, KnowledgeGraphEdgePlan>();

  const documentNode = buildDocumentNode(input.documentId);
  nodes.set(documentNode.nodeKey, documentNode);

  for (const chunk of input.chunks) {
    const chunkNode = buildChunkNode(input.documentId, chunk);
    nodes.set(chunkNode.nodeKey, chunkNode);
    const edge = buildEdgePlan({
      sourceNodeKey: documentNode.nodeKey,
      targetNodeKey: chunkNode.nodeKey,
      relationType: 'HAS_CHUNK',
      relationLabel: null,
      documentId: input.documentId,
      chunkId: chunk.id,
      extractorVersion,
      schemaVersion,
      confidence: 1,
      evidenceText: null,
      metadata: { chunkIndex: chunk.chunkIndex },
    });
    edges.set(edge.edgeKey, edge);
  }

  for (const node of input.extractedGraph?.nodes ?? []) {
    const nodePlan = buildExtractedNode(node);
    if (nodePlan) {
      nodes.set(nodePlan.nodeKey, nodePlan);
    }
  }

  for (const relation of input.extractedGraph?.edges ?? []) {
    const source = buildExtractedNode(relation.source);
    const target = buildExtractedNode(relation.target);
    if (!source || !target) continue;

    nodes.set(source.nodeKey, source);
    nodes.set(target.nodeKey, target);

    const edge = buildEdgePlan({
      sourceNodeKey: source.nodeKey,
      targetNodeKey: target.nodeKey,
      relationType: normalizeRelationType(relation.relationType),
      relationLabel: normalizeOptionalText(relation.relationLabel),
      documentId: input.documentId,
      chunkId: normalizeOptionalText(relation.chunkId),
      extractorVersion,
      schemaVersion,
      confidence: normalizeConfidence(relation.confidence),
      evidenceText: normalizeOptionalText(relation.evidenceText),
      metadata: relation.metadata ?? {},
    });
    edges.set(edge.edgeKey, edge);
  }

  return {
    documentId: input.documentId,
    extractorVersion,
    schemaVersion,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}

function buildDocumentNode(documentId: string): KnowledgeGraphNodePlan {
  return {
    nodeKey: `Document:${documentId}`,
    nodeType: 'Document',
    displayName: documentId,
    normalizedName: documentId,
    entityType: null,
    documentId,
    chunkId: null,
    aliases: [],
    metadata: {},
  };
}

function buildChunkNode(
  documentId: string,
  chunk: KnowledgeGraphChunkRef,
): KnowledgeGraphNodePlan {
  return {
    nodeKey: `Chunk:${chunk.id}`,
    nodeType: 'Chunk',
    displayName: `${chunk.source}#${chunk.chunkIndex}`,
    normalizedName: chunk.id,
    entityType: null,
    documentId,
    chunkId: chunk.id,
    aliases: [],
    metadata: {
      source: chunk.source,
      chunkIndex: chunk.chunkIndex,
    },
  };
}

function buildExtractedNode(
  node: KnowledgeGraphNodeRef & {
    aliases?: string[];
    metadata?: Record<string, unknown>;
  },
): KnowledgeGraphNodePlan | null {
  const normalizedName = normalizeGraphName(node.name);
  if (!normalizedName) return null;

  const entityType = normalizeOptionalText(node.entityType);
  const nodeKey = [node.type, entityType, normalizedName]
    .filter((item): item is string => Boolean(item))
    .join(':');

  return {
    nodeKey,
    nodeType: node.type,
    displayName: node.name.trim(),
    normalizedName,
    entityType,
    documentId: null,
    chunkId: null,
    aliases: Array.from(
      new Set((node.aliases ?? []).map(normalizeGraphName).filter(Boolean)),
    ),
    metadata: node.metadata ?? {},
  };
}

function buildEdgePlan(input: {
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
}): KnowledgeGraphEdgePlan {
  const relationType = normalizeRelationType(input.relationType);
  const chunkPart = input.chunkId ?? 'document';
  return {
    ...input,
    relationType,
    edgeKey: `${input.sourceNodeKey}->${relationType}->${input.targetNodeKey}@${input.documentId}:${chunkPart}:${input.extractorVersion}`,
  };
}

function normalizeGraphName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeRelationType(value: string): string {
  const normalized = value
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g, '')
    .trim();
  return normalized || 'RELATED_TO';
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeConfidence(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, Number(value)));
}
