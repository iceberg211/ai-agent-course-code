import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  buildKnowledgeGraphUpsertPlan,
  type BuildKnowledgeGraphUpsertPlanInput,
  type KnowledgeGraphEdgePlan,
  type KnowledgeGraphNodePlan,
} from '@/knowledge-content/graph/knowledge-graph-upsert-plan';

interface KnowledgeGraphSyncSummary {
  nodeCount: number;
  edgeCount: number;
}

@Injectable()
export class KnowledgeGraphSyncService {
  private readonly logger = new Logger(KnowledgeGraphSyncService.name);

  constructor(private readonly dataSource: DataSource) {}

  async bulkUpsertGraph(
    input: BuildKnowledgeGraphUpsertPlanInput,
  ): Promise<KnowledgeGraphSyncSummary> {
    const plan = buildKnowledgeGraphUpsertPlan({
      ...input,
      extractorVersion:
        input.extractorVersion ?? process.env.RAG_GRAPH_EXTRACTOR_VERSION,
      schemaVersion: input.schemaVersion ?? process.env.GRAPH_INDEX_VERSION,
    });

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.upsertStatus(manager, {
          documentId: plan.documentId,
          status: 'pending',
          extractorVersion: plan.extractorVersion,
          schemaVersion: plan.schemaVersion,
          nodeCount: 0,
          edgeCount: 0,
          errorMessage: null,
        });

        await manager.query(
          'DELETE FROM rag_graph_edge WHERE document_id = $1',
          [plan.documentId],
        );
        await manager.query(
          'DELETE FROM rag_graph_node WHERE document_id = $1',
          [plan.documentId],
        );

        const nodeIds = new Map<string, string>();
        for (const node of plan.nodes) {
          nodeIds.set(node.nodeKey, await this.upsertNode(manager, node));
        }

        for (const edge of plan.edges) {
          const sourceNodeId = nodeIds.get(edge.sourceNodeKey);
          const targetNodeId = nodeIds.get(edge.targetNodeKey);
          if (!sourceNodeId || !targetNodeId) continue;
          await this.upsertEdge(manager, edge, sourceNodeId, targetNodeId);
        }

        await this.upsertStatus(manager, {
          documentId: plan.documentId,
          status: 'indexed',
          extractorVersion: plan.extractorVersion,
          schemaVersion: plan.schemaVersion,
          nodeCount: plan.nodes.length,
          edgeCount: plan.edges.length,
          errorMessage: null,
        });

        return {
          nodeCount: plan.nodes.length,
          edgeCount: plan.edges.length,
        };
      });
    } catch (error) {
      await this.markFailed({
        documentId: plan.documentId,
        extractorVersion: plan.extractorVersion,
        schemaVersion: plan.schemaVersion,
        error,
      });
      throw error;
    }
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query('DELETE FROM rag_graph_edge WHERE document_id = $1', [
        documentId,
      ]);
      await manager.query('DELETE FROM rag_graph_node WHERE document_id = $1', [
        documentId,
      ]);
      await manager.query(
        'DELETE FROM rag_graph_index_status WHERE document_id = $1',
        [documentId],
      );
    });
  }

  async safeBulkUpsertGraph(
    input: BuildKnowledgeGraphUpsertPlanInput,
    context: string,
  ): Promise<void> {
    try {
      await this.bulkUpsertGraph(input);
    } catch (error) {
      this.logger.warn(
        `${context} 同步图谱派生索引失败，当前已忽略：${formatError(error)}`,
      );
    }
  }

  async safeDeleteByDocumentId(
    documentId: string,
    context: string,
  ): Promise<void> {
    try {
      await this.deleteByDocumentId(documentId);
    } catch (error) {
      this.logger.warn(
        `${context} 删除图谱派生索引失败，当前已忽略：${formatError(error)}`,
      );
    }
  }

  async markStaleByVersion(input: {
    extractorVersion: string;
    schemaVersion: string;
  }): Promise<number> {
    const result = (await this.dataSource.query(
      `
        UPDATE rag_graph_index_status
        SET
          status = 'stale',
          updated_at = now()
        WHERE status = 'indexed'
          AND (
            extractor_version <> $1
            OR schema_version <> $2
          )
        RETURNING document_id
      `,
      [input.extractorVersion, input.schemaVersion],
    )) as Array<{ document_id: string }> | { rowCount?: number } | undefined;

    if (Array.isArray(result)) return result.length;
    return Number(result?.rowCount ?? 0);
  }

  async markFailed(input: {
    documentId: string;
    extractorVersion: string;
    schemaVersion: string;
    error: unknown;
  }): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO rag_graph_index_status (
          document_id,
          status,
          extractor_version,
          schema_version,
          error_message,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (document_id) DO UPDATE SET
          status = EXCLUDED.status,
          extractor_version = EXCLUDED.extractor_version,
          schema_version = EXCLUDED.schema_version,
          error_message = EXCLUDED.error_message,
          updated_at = now()
      `,
      [
        input.documentId,
        'failed',
        input.extractorVersion,
        input.schemaVersion,
        formatError(input.error),
      ],
    );
  }

  private async upsertNode(
    manager: EntityManager,
    node: KnowledgeGraphNodePlan,
  ): Promise<string> {
    const rows = (await manager.query(
      `
        INSERT INTO rag_graph_node (
          node_key,
          node_type,
          display_name,
          normalized_name,
          entity_type,
          document_id,
          chunk_id,
          aliases,
          metadata,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
        ON CONFLICT (node_key) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          normalized_name = EXCLUDED.normalized_name,
          entity_type = EXCLUDED.entity_type,
          document_id = EXCLUDED.document_id,
          chunk_id = EXCLUDED.chunk_id,
          aliases = EXCLUDED.aliases,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING id
      `,
      [
        node.nodeKey,
        node.nodeType,
        node.displayName,
        node.normalizedName,
        node.entityType,
        node.documentId,
        node.chunkId,
        node.aliases,
        JSON.stringify(node.metadata),
      ],
    )) as Array<{ id: string }>;

    const id = rows[0]?.id;
    if (!id) {
      throw new Error(`图谱节点写入未返回 id：${node.nodeKey}`);
    }
    return id;
  }

  private async upsertEdge(
    manager: EntityManager,
    edge: KnowledgeGraphEdgePlan,
    sourceNodeId: string,
    targetNodeId: string,
  ): Promise<void> {
    await manager.query(
      `
        INSERT INTO rag_graph_edge (
          edge_key,
          source_node_id,
          target_node_id,
          relation_type,
          relation_label,
          document_id,
          chunk_id,
          extractor_version,
          schema_version,
          confidence,
          evidence_text,
          metadata,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now())
        ON CONFLICT (edge_key) DO UPDATE SET
          source_node_id = EXCLUDED.source_node_id,
          target_node_id = EXCLUDED.target_node_id,
          relation_type = EXCLUDED.relation_type,
          relation_label = EXCLUDED.relation_label,
          confidence = EXCLUDED.confidence,
          evidence_text = EXCLUDED.evidence_text,
          metadata = EXCLUDED.metadata,
          updated_at = now()
      `,
      [
        edge.edgeKey,
        sourceNodeId,
        targetNodeId,
        edge.relationType,
        edge.relationLabel,
        edge.documentId,
        edge.chunkId,
        edge.extractorVersion,
        edge.schemaVersion,
        edge.confidence,
        edge.evidenceText,
        JSON.stringify(edge.metadata),
      ],
    );
  }

  private async upsertStatus(
    manager: EntityManager,
    input: {
      documentId: string;
      status: 'pending' | 'indexed';
      extractorVersion: string;
      schemaVersion: string;
      nodeCount: number;
      edgeCount: number;
      errorMessage: string | null;
    },
  ): Promise<void> {
    await manager.query(
      `
        INSERT INTO rag_graph_index_status (
          document_id,
          status,
          extractor_version,
          schema_version,
          entity_count,
          relation_count,
          error_message,
          indexed_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          CASE WHEN $2 = 'indexed' THEN now() ELSE NULL END,
          now()
        )
        ON CONFLICT (document_id) DO UPDATE SET
          status = EXCLUDED.status,
          extractor_version = EXCLUDED.extractor_version,
          schema_version = EXCLUDED.schema_version,
          entity_count = EXCLUDED.entity_count,
          relation_count = EXCLUDED.relation_count,
          error_message = EXCLUDED.error_message,
          indexed_at = EXCLUDED.indexed_at,
          updated_at = now()
      `,
      [
        input.documentId,
        input.status,
        input.extractorVersion,
        input.schemaVersion,
        input.nodeCount,
        input.edgeCount,
        input.errorMessage,
      ],
    );
  }

}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
