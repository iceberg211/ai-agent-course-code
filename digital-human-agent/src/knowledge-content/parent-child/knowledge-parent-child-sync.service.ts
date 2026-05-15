import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  buildKnowledgeParentChildUpsertPlan,
  DEFAULT_PARENT_CHILD_MAX_CHARS,
  DEFAULT_PARENT_CHILD_MAX_CHILD_CHUNKS,
  DEFAULT_PARENT_CHILD_INDEX_VERSION,
  type BuildKnowledgeParentChildUpsertPlanInput,
  type KnowledgeParentChunkPlan,
} from '@/knowledge-content/parent-child/knowledge-parent-child-plan';

interface KnowledgeParentChildSyncSummary {
  parentCount: number;
  childCount: number;
}

@Injectable()
export class KnowledgeParentChildSyncService {
  private readonly logger = new Logger(KnowledgeParentChildSyncService.name);

  constructor(private readonly dataSource: DataSource) {}

  async bulkUpsertParentChunks(
    input: BuildKnowledgeParentChildUpsertPlanInput,
  ): Promise<KnowledgeParentChildSyncSummary> {
    const plan = buildKnowledgeParentChildUpsertPlan({
      ...input,
      indexVersion:
        input.indexVersion ?? process.env.PARENT_CHILD_INDEX_VERSION,
    });
    const maxParentChars =
      input.maxParentChars ?? Number(process.env.PARENT_CHILD_PARENT_MAX_CHARS);
    const maxChildChunks =
      input.maxChildChunks ?? Number(process.env.PARENT_CHILD_MAX_CHILD_CHUNKS);

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.upsertStatus(manager, {
          documentId: plan.documentId,
          status: 'pending',
          indexVersion: plan.indexVersion,
          parentCount: 0,
          childCount: 0,
          maxParentChars,
          maxChildChunks,
          errorMessage: null,
        });

        await manager.query(
          `
            DELETE FROM rag_parent_chunk_child child
            USING rag_parent_chunk parent
            WHERE child.parent_id = parent.id
              AND parent.document_id = $1
          `,
          [plan.documentId],
        );
        await manager.query(
          'DELETE FROM rag_parent_chunk WHERE document_id = $1',
          [plan.documentId],
        );

        let childCount = 0;
        for (const parentChunk of plan.parentChunks) {
          const parentId = await this.upsertParentChunk(
            manager,
            parentChunk,
            plan.indexVersion,
          );
          for (const [position, child] of parentChunk.children.entries()) {
            await this.insertParentChildLink(manager, {
              parentId,
              chunkId: child.id,
              documentId: parentChunk.documentId,
              chunkIndex: child.chunkIndex,
              indexVersion: plan.indexVersion,
              position,
            });
            childCount += 1;
          }
        }

        await this.upsertStatus(manager, {
          documentId: plan.documentId,
          status: 'indexed',
          indexVersion: plan.indexVersion,
          parentCount: plan.parentChunks.length,
          childCount,
          maxParentChars,
          maxChildChunks,
          errorMessage: null,
        });

        return {
          parentCount: plan.parentChunks.length,
          childCount,
        };
      });
    } catch (error) {
      await this.markFailed({
        documentId: plan.documentId,
        indexVersion: plan.indexVersion,
        error,
      });
      throw error;
    }
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
          DELETE FROM rag_parent_chunk_child child
          USING rag_parent_chunk parent
          WHERE child.parent_id = parent.id
            AND parent.document_id = $1
        `,
        [documentId],
      );
      await manager.query('DELETE FROM rag_parent_chunk WHERE document_id = $1', [
        documentId,
      ]);
      await manager.query(
        'DELETE FROM rag_parent_chunk_index_status WHERE document_id = $1',
        [documentId],
      );
    });
  }

  async safeBulkUpsertParentChunks(
    input: BuildKnowledgeParentChildUpsertPlanInput,
    context: string,
  ): Promise<void> {
    try {
      await this.bulkUpsertParentChunks(input);
    } catch (error) {
      this.logger.warn(
        `${context} 同步 Parent-Child 派生索引失败，当前已忽略：${formatError(error)}`,
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
        `${context} 删除 Parent-Child 派生索引失败，当前已忽略：${formatError(error)}`,
      );
    }
  }

  async markStaleByVersion(input: { indexVersion: string }): Promise<number> {
    const result = (await this.dataSource.query(
      `
        UPDATE rag_parent_chunk_index_status
        SET
          status = 'stale',
          updated_at = now()
        WHERE status = 'indexed'
          AND index_version <> $1
        RETURNING document_id
      `,
      [input.indexVersion],
    )) as Array<{ document_id: string }> | { rowCount?: number } | undefined;

    if (Array.isArray(result)) return result.length;
    return Number(result?.rowCount ?? 0);
  }

  async markFailed(input: {
    documentId: string;
    indexVersion?: string;
    error: unknown;
  }): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO rag_parent_chunk_index_status (
          document_id,
          status,
          index_version,
          error_message,
          updated_at
        )
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (document_id) DO UPDATE SET
          status = EXCLUDED.status,
          index_version = EXCLUDED.index_version,
          error_message = EXCLUDED.error_message,
          updated_at = now()
      `,
      [
        input.documentId,
        'failed',
        input.indexVersion?.trim() || currentParentChildIndexVersion(),
        formatError(input.error),
      ],
    );
  }

  private async upsertParentChunk(
    manager: EntityManager,
    parentChunk: KnowledgeParentChunkPlan,
    indexVersion: string,
  ): Promise<string> {
    const rows = (await manager.query(
      `
        INSERT INTO rag_parent_chunk (
          parent_key,
          document_id,
          source,
          category,
          start_chunk_index,
          end_chunk_index,
          child_chunk_ids,
          content,
          index_version,
          metadata,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9, $10::jsonb, now())
        ON CONFLICT (parent_key) DO UPDATE SET
          source = EXCLUDED.source,
          category = EXCLUDED.category,
          start_chunk_index = EXCLUDED.start_chunk_index,
          end_chunk_index = EXCLUDED.end_chunk_index,
          child_chunk_ids = EXCLUDED.child_chunk_ids,
          content = EXCLUDED.content,
          index_version = EXCLUDED.index_version,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING id
      `,
      [
        parentChunk.parentKey,
        parentChunk.documentId,
        parentChunk.source,
        parentChunk.category,
        parentChunk.startChunkIndex,
        parentChunk.endChunkIndex,
        parentChunk.childChunkIds,
        parentChunk.content,
        indexVersion,
        JSON.stringify(parentChunk.metadata),
      ],
    )) as Array<{ id: string }>;

    const id = rows[0]?.id;
    if (!id) {
      throw new Error(`Parent-Child 父块写入未返回 id：${parentChunk.parentKey}`);
    }
    return id;
  }

  private async insertParentChildLink(
    manager: EntityManager,
    input: {
      parentId: string;
      chunkId: string;
      documentId: string;
      chunkIndex: number;
      indexVersion: string;
      position: number;
    },
  ): Promise<void> {
    await manager.query(
      `
        INSERT INTO rag_parent_chunk_child (
          parent_id,
          chunk_id,
          document_id,
          chunk_index,
          index_version,
          position
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (parent_id, chunk_id) DO UPDATE SET
          document_id = EXCLUDED.document_id,
          chunk_index = EXCLUDED.chunk_index,
          index_version = EXCLUDED.index_version,
          position = EXCLUDED.position
      `,
      [
        input.parentId,
        input.chunkId,
        input.documentId,
        input.chunkIndex,
        input.indexVersion,
        input.position,
      ],
    );
  }

  private async upsertStatus(
    manager: EntityManager,
    input: {
      documentId: string;
      status: 'pending' | 'indexed';
      indexVersion: string;
      parentCount: number;
      childCount: number;
      maxParentChars: number | undefined;
      maxChildChunks: number | undefined;
      errorMessage: string | null;
    },
  ): Promise<void> {
    await manager.query(
      `
        INSERT INTO rag_parent_chunk_index_status (
          document_id,
          status,
          index_version,
          parent_count,
          child_count,
          max_parent_chars,
          max_child_chunks,
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
          $8,
          CASE WHEN $2 = 'indexed' THEN now() ELSE NULL END,
          now()
        )
        ON CONFLICT (document_id) DO UPDATE SET
          status = EXCLUDED.status,
          index_version = EXCLUDED.index_version,
          parent_count = EXCLUDED.parent_count,
          child_count = EXCLUDED.child_count,
          max_parent_chars = EXCLUDED.max_parent_chars,
          max_child_chunks = EXCLUDED.max_child_chunks,
          error_message = EXCLUDED.error_message,
          indexed_at = EXCLUDED.indexed_at,
          updated_at = now()
      `,
      [
        input.documentId,
        input.status,
        input.indexVersion,
        input.parentCount,
        input.childCount,
        normalizeStatusInteger(
          input.maxParentChars,
          DEFAULT_PARENT_CHILD_MAX_CHARS,
        ),
        normalizeStatusInteger(
          input.maxChildChunks,
          DEFAULT_PARENT_CHILD_MAX_CHILD_CHUNKS,
        ),
        input.errorMessage,
      ],
    );
  }
}

function currentParentChildIndexVersion(): string {
  return (
    process.env.PARENT_CHILD_INDEX_VERSION?.trim() ||
    DEFAULT_PARENT_CHILD_INDEX_VERSION
  );
}

function normalizeStatusInteger(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.trunc(Number(value))
    : fallback;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
