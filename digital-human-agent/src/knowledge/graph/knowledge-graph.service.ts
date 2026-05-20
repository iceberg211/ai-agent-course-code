import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { throwIfAborted } from '@/common/utils';
import { Neo4jGraphService } from '@/knowledge/graph/neo4j-graph.service';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import {
  type KnowledgeGraphChunkRef,
  type ExtractedKnowledgeGraphNode,
  type ExtractedKnowledgeGraphEdge,
  type ExtractedKnowledgeGraph,
  type Neo4jGraphRetrieveRow,
  type Neo4jGraphRetrieveParams,
  type Neo4jGraphSyncInput,
  type Neo4jGraphSyncSummary,
  type Neo4jGraphSyncResult,
} from '@/knowledge/types/knowledge-graph.types';
import { buildKnowledgeGraphUpsertPlan } from './upsert-plan';
import {
  buildNeo4jGraphRetrieveQuery,
  buildNeo4jGraphSearchTerms,
  normalizeNeo4jGraphMaxHops,
  toCypherRelationshipType,
} from './query.builder';
import {
  toNeo4jKnowledgeChunk,
  extractMarkdownHeadings,
  normalizeDisplayName,
  extractPartyTerms,
  buildEvidenceExcerpt,
} from './mapper';

// ==========================================
// 核心 Service 实现
// ==========================================

@Injectable()
export class KnowledgeGraphService {
  private readonly logger = new Logger(KnowledgeGraphService.name);

  constructor(
    private readonly neo4jGraphService: Neo4jGraphService,
    private readonly configService: ConfigService,
  ) {}

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
      extractorVersion: this.configService.get<string>(
        'NEO4J_GRAPH_EXTRACTOR_VERSION',
      ),
      schemaVersion: this.configService.get<string>(
        'NEO4J_GRAPH_SCHEMA_VERSION',
      ),
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
