import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeChunkIndexDocument } from '@/knowledge-content/elasticsearch/elasticsearch.types';
import { ElasticsearchIndexService } from '@/knowledge-content/elasticsearch/elasticsearch-index.service';

@Injectable()
export class ElasticsearchSyncService {
  private readonly logger = new Logger(ElasticsearchSyncService.name);

  constructor(
    private readonly elasticsearchIndexService: ElasticsearchIndexService,
  ) {}

  async bulkUpsertChunkDocuments(
    documents: KnowledgeChunkIndexDocument[],
  ): Promise<void> {
    if (documents.length === 0) return;

    const client = this.elasticsearchIndexService.getClient();
    if (!client || !this.elasticsearchIndexService.isEnabled()) return;

    await this.elasticsearchIndexService.ensureKnowledgeChunkIndex();

    const operations = documents.flatMap((document) => [
      {
        update: {
          _index: this.elasticsearchIndexService.getKnowledgeChunkWriteAlias(),
          _id: document.id,
        },
      },
      {
        doc: document,
        doc_as_upsert: true,
      },
    ]);

    const result = await client.bulk({
      refresh: false,
      operations,
    });

    if (!result.errors) {
      return;
    }

    const failedItems = result.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => Boolean(item.update?.error))
      .slice(0, 5)
      .map(({ item, index }) => ({
        index,
        error: item.update?.error?.reason ?? 'unknown',
      }));

    throw new Error(
      `ES bulk upsert 失败，共 ${failedItems.length} 条报错：${JSON.stringify(
        failedItems,
      )}`,
    );
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    const client = this.elasticsearchIndexService.getClient();
    if (!client || !this.elasticsearchIndexService.isEnabled()) return;

    await client.deleteByQuery({
      index: this.elasticsearchIndexService.getKnowledgeChunkWriteAlias(),
      refresh: false,
      query: {
        term: {
          document_id: documentId,
        },
      },
    });
  }

  async safeBulkUpsertChunkDocuments(
    documents: KnowledgeChunkIndexDocument[],
    context: string,
  ): Promise<void> {
    try {
      await this.bulkUpsertChunkDocuments(documents);
    } catch (error) {
      this.logger.warn(
        `${context} 同步 ES 失败，当前已忽略：${
          error instanceof Error ? error.message : String(error)
        }`,
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
        `${context} 删除 ES 文档失败，当前已忽略：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
