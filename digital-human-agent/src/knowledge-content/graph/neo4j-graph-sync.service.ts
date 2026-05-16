import { Injectable, Logger } from '@nestjs/common';
import { buildKnowledgeGraphUpsertPlan } from '@/knowledge-content/graph/knowledge-graph-upsert-plan';
import type {
  ExtractedKnowledgeGraph,
  KnowledgeGraphChunkRef,
} from '@/knowledge-content/graph/knowledge-graph-upsert-plan';
import { Neo4jGraphService } from '@/knowledge-content/graph/neo4j-graph.service';

export interface Neo4jGraphSyncInput {
  documentId: string;
  knowledgeId: string;
  source: string;
  chunks: KnowledgeGraphChunkRef[];
  extractedGraph?: ExtractedKnowledgeGraph;
}

export interface Neo4jGraphSyncSummary {
  documentId: string;
  chunkCount: number;
  nodeCount: number;
  edgeCount: number;
}

@Injectable()
export class Neo4jGraphSyncService {
  private readonly logger = new Logger(Neo4jGraphSyncService.name);

  constructor(private readonly neo4jGraphService: Neo4jGraphService) {}

  isEnabled(): boolean {
    return this.neo4jGraphService.isEnabled();
  }

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

  async safeUpsertDocument(input: Neo4jGraphSyncInput): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      await this.upsertDocument(input);
    } catch (error) {
      this.logger.warn(
        `Neo4j 写入文档图谱失败（document=${input.documentId}）：${
          error instanceof Error ? error.message : String(error)
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
      plan.nodes.filter((node) => !['Document', 'Chunk'].includes(node.nodeType)),
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

  private async upsertDocumentAndChunks(input: Neo4jGraphSyncInput): Promise<void> {
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
      edgesByType.set(relationType, [...(edgesByType.get(relationType) ?? []), edge]);
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

function toCypherRelationshipType(value: string): string {
  const normalized = value
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g, '')
    .trim();
  return `\`${normalized || 'RELATED_TO'}\``;
}
