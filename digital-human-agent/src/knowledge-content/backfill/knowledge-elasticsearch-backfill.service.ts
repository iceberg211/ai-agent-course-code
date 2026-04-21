import { Injectable } from '@nestjs/common';
import { ElasticsearchIndexService } from '@/knowledge-content/elasticsearch/elasticsearch-index.service';
import { ElasticsearchSyncService } from '@/knowledge-content/elasticsearch/elasticsearch-sync.service';
import { KnowledgeChunkIndexCursor } from '@/knowledge-content/elasticsearch/elasticsearch.types';
import { KnowledgeChunkIndexQueryService } from '@/knowledge-content/elasticsearch/knowledge-chunk-index-query.service';

interface BackfillSummary {
  pageCount: number;
  chunkCount: number;
}

@Injectable()
export class KnowledgeElasticsearchBackfillService {
  constructor(
    private readonly elasticsearchIndexService: ElasticsearchIndexService,
    private readonly elasticsearchSyncService: ElasticsearchSyncService,
    private readonly knowledgeChunkIndexQueryService: KnowledgeChunkIndexQueryService,
  ) {}

  async backfillAll(pageSize = 200): Promise<BackfillSummary> {
    if (!this.elasticsearchIndexService.isEnabled()) {
      throw new Error(
        'ELASTICSEARCH_ENABLED=false，无法执行回填，请先启动 ES 并开启环境变量',
      );
    }

    await this.elasticsearchIndexService.ensureKnowledgeChunkIndex();

    let cursor: KnowledgeChunkIndexCursor | undefined;
    let pageCount = 0;
    let chunkCount = 0;

    while (true) {
      const page = await this.knowledgeChunkIndexQueryService.listPage(
        pageSize,
        cursor,
      );
      const documents = page.items;
      if (documents.length === 0) {
        break;
      }

      await this.elasticsearchSyncService.bulkUpsertChunkDocuments(documents);
      pageCount += 1;
      chunkCount += documents.length;

      if (!page.nextCursor || documents.length < pageSize) {
        break;
      }
      cursor = page.nextCursor;
    }

    return {
      pageCount,
      chunkCount,
    };
  }
}
