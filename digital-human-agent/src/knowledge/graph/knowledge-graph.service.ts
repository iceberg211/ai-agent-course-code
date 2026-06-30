import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { throwIfAborted } from '@/common/utils';
import { Neo4jGraphService } from '@/knowledge/graph/neo4j-graph.service';
import type {
  KnowledgeAccessScope,
  KnowledgeChunk,
} from '@/knowledge/types/knowledge-content.types';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge/entities/knowledge-chunk.entity';
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
import { extractGraphFromChunks } from './extractor';
import {
  toNeo4jKnowledgeChunk,
} from './mapper';
import { applyDocumentAccessScope } from '@/knowledge/utils/document-access.util';

// ==========================================
// 核心 Service 实现
// ==========================================

@Injectable()
export class KnowledgeGraphService {
  private readonly logger = new Logger(KnowledgeGraphService.name);

  constructor(
    private readonly neo4jGraphService: Neo4jGraphService,
    private readonly configService: ConfigService,
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
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
        isAdmin: params.accessScope?.role === 'admin',
        ownerId: params.accessScope?.ownerId ?? '',
        department: params.accessScope?.department ?? '',
        role: params.accessScope?.role ?? '',
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
    const config = {
      subtopicType: this.configService.get<string>('NEO4J_RELATION_SUBTOPIC_TYPE'),
      subtopicLabel: this.configService.get<string>('NEO4J_RELATION_SUBTOPIC_LABEL'),
      mentionsType: this.configService.get<string>('NEO4J_RELATION_MENTIONS_TYPE'),
      mentionsLabel: this.configService.get<string>('NEO4J_RELATION_MENTIONS_LABEL'),
    };
    return extractGraphFromChunks(input.chunks, config);
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

  async safeRefreshChunkAccessMetadata(
    input: {
      documentId: string;
      allowedUserIds: string[] | null;
      allowedRoleIds: string[] | null;
      allowedDepartmentIds: string[] | null;
      securityLevel: number;
      aclVersion: number;
    },
    reason: string,
  ): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      await this.neo4jGraphService.query(
        `
          MATCH (c:KnowledgeChunk {documentId: $documentId})
          SET
            c.allowedUserIds = $allowedUserIds,
            c.allowedRoleIds = $allowedRoleIds,
            c.allowedDepartmentIds = $allowedDepartmentIds,
            c.securityLevel = $securityLevel,
            c.aclVersion = $aclVersion,
            c.updatedAt = datetime()
        `,
        input,
      );
    } catch (error) {
      this.logger.warn(
        `Neo4j 刷新 chunk 权限元数据失败（${reason}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
          d.isCurrentVersion = $isCurrentVersion,
          d.isArchived = $isArchived,
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
          c.allowedUserIds = row.allowedUserIds,
          c.allowedRoleIds = row.allowedRoleIds,
          c.allowedDepartmentIds = row.allowedDepartmentIds,
          c.securityLevel = coalesce(row.securityLevel, 0),
          c.aclVersion = coalesce(row.aclVersion, 1),
          c.isCurrentVersion = $isCurrentVersion,
          c.isArchived = $isArchived,
          c.updatedAt = datetime()
        MERGE (d)-[:HAS_CHUNK]->(c)
      `,
      {
        documentId: input.documentId,
        knowledgeId: input.knowledgeId,
        source: input.source,
        isCurrentVersion: input.isCurrentVersion ?? true,
        isArchived: input.isArchived ?? false,
        chunks: input.chunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          source: chunk.source,
          category: chunk.category ?? null,
          content: chunk.content ?? '',
          allowedUserIds: chunk.allowedUserIds ?? null,
          allowedRoleIds: chunk.allowedRoleIds ?? null,
          allowedDepartmentIds: chunk.allowedDepartmentIds ?? null,
          securityLevel: chunk.securityLevel ?? 0,
          aclVersion: chunk.aclVersion ?? 1,
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

  async listEntities(
    knowledgeId: string,
    query?: string,
    limit = 100,
    accessScope?: KnowledgeAccessScope,
  ): Promise<any[]> {
    if (!this.isEnabled()) return [];
    const chunkIds = await this.findVisibleCurrentChunkIds(knowledgeId, accessScope);
    if (chunkIds.length === 0) return [];

    const filterSql = query ? 'AND (n.displayName CONTAINS $query OR n.normalizedName CONTAINS $query)' : '';
    const cypher = `
      MATCH (c:KnowledgeChunk {knowledgeId: $knowledgeId})
      MATCH (source:GraphNode)-[rel]->(target:GraphNode)
      WHERE rel.chunkId = c.id AND c.enabled = true AND c.id IN $chunkIds
      WITH collect(distinct source) + collect(distinct target) as nodes
      UNWIND nodes as n
      WITH distinct n
      WHERE 1=1 ${filterSql}
      RETURN n.nodeKey as key, n.nodeType as type, n.displayName as name, n.entityType as entityType, n.aliases as aliases
      LIMIT $limit
    `;

    return this.neo4jGraphService.query(cypher, {
      knowledgeId,
      chunkIds,
      query: query ?? '',
      limit: Math.max(1, Math.min(200, limit)),
    });
  }

  async listRelations(
    knowledgeId: string,
    limit = 100,
    accessScope?: KnowledgeAccessScope,
  ): Promise<any[]> {
    if (!this.isEnabled()) return [];
    const chunkIds = await this.findVisibleCurrentChunkIds(knowledgeId, accessScope);
    if (chunkIds.length === 0) return [];

    const cypher = `
      MATCH (c:KnowledgeChunk {knowledgeId: $knowledgeId})
      MATCH (source:GraphNode)-[rel]->(target:GraphNode)
      WHERE rel.chunkId = c.id AND c.enabled = true AND c.id IN $chunkIds
      RETURN 
        rel.edgeKey as key,
        source.displayName as source,
        target.displayName as target,
        rel.relationType as relationType,
        rel.relationLabel as relationLabel,
        rel.confidence as confidence,
        rel.evidenceText as evidenceText,
        rel.chunkId as chunkId,
        rel.documentId as documentId
      LIMIT $limit
    `;

    return this.neo4jGraphService.query(cypher, {
      knowledgeId,
      chunkIds,
      limit: Math.max(1, Math.min(200, limit)),
    });
  }

  async getNeighborhood(
    knowledgeId: string,
    nodeKey: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<any[]> {
    if (!this.isEnabled()) return [];
    const chunkIds = await this.findVisibleCurrentChunkIds(knowledgeId, accessScope);
    if (chunkIds.length === 0) return [];

    const cypher = `
      MATCH (c:KnowledgeChunk {knowledgeId: $knowledgeId})
      MATCH (center:GraphNode {nodeKey: $nodeKey})-[rel]-(neighbor:GraphNode)
      WHERE rel.chunkId = c.id AND c.enabled = true AND c.id IN $chunkIds
      MATCH (chunkNode:KnowledgeChunk {id: rel.chunkId})
      RETURN distinct
        chunkNode.id as id,
        chunkNode.documentId as document_id,
        chunkNode.knowledgeId as knowledge_base_id,
        chunkNode.content as content,
        chunkNode.source as source,
        chunkNode.chunkIndex as chunk_index,
        chunkNode.category as category,
        center.displayName as sourceName,
        neighbor.displayName as targetName,
        rel.relationType as relationType,
        rel.relationLabel as relationLabel,
        rel.confidence as confidence,
        rel.evidenceText as evidenceText
    `;

    return this.neo4jGraphService.query(cypher, {
      knowledgeId,
      nodeKey,
      chunkIds,
    });
  }

  async rebuildGraph(knowledgeId: string): Promise<{
    success: boolean;
    documentCount: number;
    indexedCount: number;
    skippedCount: number;
    failedCount: number;
    errors: Array<{ documentId: string; message: string }>;
  }> {
    if (!this.isEnabled()) {
      return {
        success: false,
        documentCount: 0,
        indexedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        errors: [],
      };
    }

    const documents = await this.documentRepo.find({
      where: {
        knowledgeBaseId: knowledgeId,
        archivedAt: IsNull(),
        isCurrentVersion: true,
      },
    });
    if (documents.length === 0) {
      return {
        success: true,
        documentCount: 0,
        indexedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        errors: [],
      };
    }

    let indexedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const errors: Array<{ documentId: string; message: string }> = [];

    for (const doc of documents) {
      try {
        // 1. 删除旧图谱节点关系
        await this.safeDeleteByDocumentId(doc.id, 'rebuild_graph');

        // 2. 拉取此文档下所有启用的 chunks
        const chunks = await this.chunkRepo.find({
          where: { documentId: doc.id, enabled: true },
          order: { chunkIndex: 'ASC' },
        });
        if (chunks.length === 0) {
          skippedCount += 1;
          await this.documentRepo.update(doc.id, {
            graphSyncStatus: 'skipped',
            graphSyncError: null,
            graphSyncedAt: null,
          });
          continue;
        }

        // 3. 提取实体并载入安全元数据
        const graphInput: KnowledgeGraphChunkRef[] = chunks.map((c) => ({
          id: c.id,
          source: c.source,
          chunkIndex: c.chunkIndex,
          content: c.content,
          category: c.category ?? undefined,
          allowedUserIds: c.allowedUserIds,
          allowedRoleIds: c.allowedRoleIds,
          allowedDepartmentIds: c.allowedDepartmentIds,
          securityLevel: c.securityLevel,
          aclVersion: c.aclVersion,
        }));

        const extractedGraph = await this.extract({
          documentId: doc.id,
          chunks: graphInput,
        });

        // 4. 持久化到 Neo4j（传入当前版本和归档状态标志）
        const syncResult = await this.safeUpsertDocument({
          documentId: doc.id,
          knowledgeId,
          source: doc.filename,
          chunks: graphInput,
          extractedGraph,
          isCurrentVersion: doc.isCurrentVersion,
          isArchived: doc.archivedAt !== null,
        });
        if (syncResult.status === 'indexed') {
          indexedCount += 1;
          await this.documentRepo.update(doc.id, {
            graphSyncStatus: 'indexed',
            graphSyncError: null,
            graphSyncedAt: new Date(),
          });
        } else if (syncResult.status === 'skipped') {
          skippedCount += 1;
          await this.documentRepo.update(doc.id, {
            graphSyncStatus: 'skipped',
            graphSyncError: null,
            graphSyncedAt: null,
          });
        } else {
          failedCount += 1;
          errors.push({
            documentId: doc.id,
            message: syncResult.errorMessage,
          });
          await this.documentRepo.update(doc.id, {
            graphSyncStatus: 'failed',
            graphSyncError: syncResult.errorMessage,
            graphSyncedAt: null,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failedCount += 1;
        errors.push({
          documentId: doc.id,
          message,
        });
        await this.documentRepo.update(doc.id, {
          graphSyncStatus: 'failed',
          graphSyncError: message,
          graphSyncedAt: null,
        });
      }
    }

    return {
      success: failedCount === 0,
      documentCount: documents.length,
      indexedCount,
      skippedCount,
      failedCount,
      errors,
    };
  }

  private async findVisibleCurrentChunkIds(
    knowledgeId: string,
    accessScope?: KnowledgeAccessScope,
  ): Promise<string[]> {
    const qb = this.chunkRepo
      .createQueryBuilder('chunk')
      .select('chunk.id', 'id')
      .innerJoin('chunk.document', 'document')
      .where('document.knowledge_base_id = :knowledgeId', { knowledgeId })
      .andWhere('document.archived_at IS NULL')
      .andWhere('document.is_current_version = true')
      .andWhere('chunk.enabled = true');

    applyDocumentAccessScope(qb, 'document', accessScope);

    const rows = await qb.getRawMany<{ id: string }>();
    return rows.map((row) => row.id).filter(Boolean);
  }
}
