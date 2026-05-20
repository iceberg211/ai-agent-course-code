import { Injectable, Logger } from '@nestjs/common';
import { throwIfAborted } from '@/common/utils';
import { Neo4jGraphService } from '@/knowledge/graph/neo4j-graph.service';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

// ==========================================
// 接口与常数定义 (从 upsert-plan 等文件迁移)
// ==========================================

import {
  DEFAULT_RAG_GRAPH_SCHEMA_VERSION,
  DEFAULT_RAG_GRAPH_EXTRACTOR_VERSION,
  type KnowledgeGraphNodeType,
  type KnowledgeGraphChunkRef,
  type KnowledgeGraphNodeRef,
  type ExtractedKnowledgeGraphNode,
  type ExtractedKnowledgeGraphEdge,
  type ExtractedKnowledgeGraph,
  type BuildKnowledgeGraphUpsertPlanInput,
  type KnowledgeGraphNodePlan,
  type KnowledgeGraphEdgePlan,
  type KnowledgeGraphUpsertPlan,
  type Neo4jGraphEvidence,
  type Neo4jGraphRetrieveRow,
  type Neo4jGraphRetrieveParams,
  type Neo4jGraphSyncInput,
  type Neo4jGraphSyncSummary,
  type Neo4jGraphSyncResult,
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

// ==========================================
// 辅助纯函数 (从 upsert-plan.ts, query.builder.ts, mapper.ts)
// ==========================================

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

export function buildNeo4jGraphRetrieveQuery(
  graphMode: 'neighbors' | 'path' | undefined,
  graphMaxHops: number | undefined,
): string {
  const maxHops = normalizeNeo4jGraphMaxHops(graphMaxHops);
  return graphMode === 'path' ? buildPathQuery(maxHops) : NEIGHBOR_QUERY;
}

export function buildNeo4jGraphSearchTerms(
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

export function normalizeNeo4jGraphMaxHops(value: number | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(3, Math.max(1, Math.trunc(parsed)));
}

function toCypherRelationshipType(value: string): string {
  const normalized = value
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g, '')
    .trim();
  return `\`${normalized || 'RELATED_TO'}\``;
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

function extractMarkdownHeadings(content: string) {
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

function normalizeDisplayName(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPartyTerms(content: string): string[] {
  return PARTY_TERMS.filter((term) => content.includes(term));
}

function buildEvidenceExcerpt(content: string, term: string): string {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  const index = normalizedContent.indexOf(term);
  if (index < 0) return normalizedContent.slice(0, 160);

  const start = Math.max(0, index - 50);
  const end = Math.min(normalizedContent.length, index + term.length + 90);
  return normalizedContent.slice(start, end);
}

// ==========================================
// 核心 Service 实现
// ==========================================

@Injectable()
export class KnowledgeGraphService {
  private readonly logger = new Logger(KnowledgeGraphService.name);

  constructor(private readonly neo4jGraphService: Neo4jGraphService) {}

  isEnabled(): boolean {
    return this.neo4jGraphService.isEnabled();
  }

  // ==========================================
  // Neo4j 知识检索方法 (原本在 neo4j-graph-retriever.service.ts)
  // ==========================================
  async retrieve(params: Neo4jGraphRetrieveParams): Promise<KnowledgeChunk[]> {
    if (!this.isEnabled()) return [];

    throwIfAborted(params.signal);
    const terms = buildNeo4jGraphSearchTerms(
      params.keywordTerms,
      params.retrievalQuery,
    );
    if (terms.length === 0) return [];
    const maxHops = normalizeNeo4jGraphMaxHops(params.graphMaxHops);

    const rows = await this.neo4jGraphService.query<Neo4jGraphRetrieveRow>(
      buildNeo4jGraphRetrieveQuery(params.graphMode, maxHops),
      {
        knowledgeId: params.knowledgeId,
        terms,
        matchCount: Math.max(1, Math.trunc(params.matchCount)),
        maxHops,
      },
    );
    throwIfAborted(params.signal);

    return rows.map(toNeo4jKnowledgeChunk);
  }

  // ==========================================
  // 知识提取方法 (原本在 knowledge-graph-extractor.service.ts)
  // ==========================================
  async extract(input: {
    documentId: string;
    chunks: KnowledgeGraphChunkRef[];
  }): Promise<ExtractedKnowledgeGraph> {
    const nodes = new Map<string, ExtractedKnowledgeGraphNode>();
    const edges = new Map<string, ExtractedKnowledgeGraphEdge>();

    for (const chunk of input.chunks) {
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

  // ==========================================
  // Neo4j 图谱同步与持久化方法 (原本在 neo4j-graph-sync.service.ts)
  // ==========================================
  async safeDeleteByDocumentId(
    documentId: string,
    reason: string,
  ): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      await this.deleteByDocumentId(documentId);
    } catch (error) {
      this.logger.warn(
        `Neo4j 删除文档图谱失败（${reason}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async safeUpsertDocument(
    input: Neo4jGraphSyncInput,
  ): Promise<Neo4jGraphSyncResult> {
    if (!this.isEnabled()) {
      return { status: 'skipped' };
    }

    try {
      await this.upsertDocument(input);
      return { status: 'indexed' };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Neo4j 写入文档图谱失败（document=${input.documentId}）：${errorMessage}`,
      );
      await this.cleanupFailedUpsert(input.documentId);
      return { status: 'failed', errorMessage };
    }
  }

  async safeUpdateChunkEnabled(
    chunkId: string,
    enabled: boolean,
    reason: string,
  ): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      await this.updateChunkEnabled(chunkId, enabled);
    } catch (error) {
      this.logger.warn(
        `Neo4j 更新 chunk 启停状态失败（${reason}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async updateChunkEnabled(chunkId: string, enabled: boolean): Promise<void> {
    await this.neo4jGraphService.query(
      `
        MATCH (c:KnowledgeChunk {id: $chunkId})
        SET
          c.enabled = $enabled,
          c.updatedAt = datetime()
      `,
      { chunkId, enabled },
    );
  }

  private async cleanupFailedUpsert(documentId: string): Promise<void> {
    try {
      await this.deleteByDocumentId(documentId);
    } catch (cleanupError) {
      this.logger.warn(
        `Neo4j 清理半写入图谱失败（document=${documentId}）：${
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError)
        }`,
      );
    }
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.neo4jGraphService.query(
      `
        MATCH ()-[r]-()
        WHERE r.documentId = $documentId
        DELETE r
      `,
      { documentId },
    );
    await this.neo4jGraphService.query(
      `
        MATCH (d:KnowledgeDocument {id: $documentId})
        DETACH DELETE d
      `,
      { documentId },
    );
    await this.neo4jGraphService.query(
      `
        MATCH (c:KnowledgeChunk {documentId: $documentId})
        DETACH DELETE c
      `,
      { documentId },
    );
  }

  async upsertDocument(
    input: Neo4jGraphSyncInput,
  ): Promise<Neo4jGraphSyncSummary> {
    await this.ensureSchema();
    await this.deleteByDocumentId(input.documentId);

    const plan = buildKnowledgeGraphUpsertPlan({
      documentId: input.documentId,
      chunks: input.chunks,
      extractedGraph: input.extractedGraph,
      extractorVersion: process.env.NEO4J_GRAPH_EXTRACTOR_VERSION,
      schemaVersion: process.env.NEO4J_GRAPH_SCHEMA_VERSION,
    });

    await this.upsertDocumentAndChunks(input);
    await this.upsertGraphNodes(
      plan.nodes.filter(
        (node) => !['Document', 'Chunk'].includes(node.nodeType),
      ),
    );
    await this.upsertGraphEdges(
      plan.edges.filter((edge) => edge.relationType !== 'HAS_CHUNK'),
    );

    return {
      documentId: input.documentId,
      chunkCount: input.chunks.length,
      nodeCount: plan.nodes.length,
      edgeCount: plan.edges.length,
    };
  }

  async ensureSchema(): Promise<void> {
    await this.neo4jGraphService.query(`
      CREATE CONSTRAINT dha_document_id IF NOT EXISTS
      FOR (d:KnowledgeDocument)
      REQUIRE d.id IS UNIQUE
    `);
    await this.neo4jGraphService.query(`
      CREATE CONSTRAINT dha_chunk_id IF NOT EXISTS
      FOR (c:KnowledgeChunk)
      REQUIRE c.id IS UNIQUE
    `);
    await this.neo4jGraphService.query(`
      CREATE CONSTRAINT dha_graph_node_key IF NOT EXISTS
      FOR (n:GraphNode)
      REQUIRE n.nodeKey IS UNIQUE
    `);
    await this.neo4jGraphService.query(`
      CREATE INDEX dha_chunk_knowledge IF NOT EXISTS
      FOR (c:KnowledgeChunk)
      ON (c.knowledgeId)
    `);
  }

  private async upsertDocumentAndChunks(
    input: Neo4jGraphSyncInput,
  ): Promise<void> {
    await this.neo4jGraphService.query(
      `
        MERGE (d:KnowledgeDocument {id: $documentId})
        SET
          d.knowledgeId = $knowledgeId,
          d.source = $source,
          d.updatedAt = datetime()
        WITH d
        UNWIND $chunks AS row
        MERGE (c:KnowledgeChunk {id: row.id})
        SET
          c.documentId = $documentId,
          c.knowledgeId = $knowledgeId,
          c.chunkIndex = row.chunkIndex,
          c.source = row.source,
          c.category = row.category,
          c.content = row.content,
          c.enabled = true,
          c.updatedAt = datetime()
        MERGE (d)-[:HAS_CHUNK]->(c)
      `,
      {
        documentId: input.documentId,
        knowledgeId: input.knowledgeId,
        source: input.source,
        chunks: input.chunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          source: chunk.source,
          category: chunk.category ?? null,
          content: chunk.content ?? '',
        })),
      },
    );
  }

  private async upsertGraphNodes(
    nodes: Array<{
      nodeKey: string;
      nodeType: string;
      displayName: string;
      normalizedName: string;
      entityType: string | null;
      aliases: string[];
      metadata: Record<string, unknown>;
    }>,
  ): Promise<void> {
    if (nodes.length === 0) return;

    await this.neo4jGraphService.query(
      `
        UNWIND $nodes AS row
        MERGE (n:GraphNode {nodeKey: row.nodeKey})
        SET
          n.nodeType = row.nodeType,
          n.displayName = row.displayName,
          n.normalizedName = row.normalizedName,
          n.entityType = row.entityType,
          n.aliases = row.aliases,
          n.metadataJson = row.metadataJson,
          n.updatedAt = datetime()
      `,
      {
        nodes: nodes.map((node) => ({
          ...node,
          metadataJson: JSON.stringify(node.metadata ?? {}),
        })),
      },
    );
  }

  private async upsertGraphEdges(
    edges: Array<{
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
    }>,
  ): Promise<void> {
    const edgesByType = new Map<string, typeof edges>();
    for (const edge of edges) {
      const relationType = toCypherRelationshipType(edge.relationType);
      edgesByType.set(relationType, [
        ...(edgesByType.get(relationType) ?? []),
        edge,
      ]);
    }

    for (const [relationType, batch] of edgesByType) {
      await this.neo4jGraphService.query(
        `
          UNWIND $edges AS row
          MATCH (source:GraphNode {nodeKey: row.sourceNodeKey})
          MATCH (target:GraphNode {nodeKey: row.targetNodeKey})
          MERGE (source)-[rel:${relationType} {edgeKey: row.edgeKey}]->(target)
          SET
            rel.relationType = row.relationType,
            rel.relationLabel = row.relationLabel,
            rel.documentId = row.documentId,
            rel.chunkId = row.chunkId,
            rel.extractorVersion = row.extractorVersion,
            rel.schemaVersion = row.schemaVersion,
            rel.confidence = row.confidence,
            rel.evidenceText = row.evidenceText,
            rel.metadataJson = row.metadataJson,
            rel.updatedAt = datetime()
        `,
        {
          edges: batch.map((edge) => ({
            ...edge,
            metadataJson: JSON.stringify(edge.metadata ?? {}),
          })),
        },
      );
    }
  }
}
