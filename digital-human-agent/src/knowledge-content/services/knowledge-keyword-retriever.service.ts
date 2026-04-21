import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { DEFAULT_HYBRID_KEYWORD_BACKEND } from '@/common/constants';
import { ElasticsearchIndexService } from '@/knowledge-content/elasticsearch/elasticsearch-index.service';
import { ElasticKeywordRetrieverService } from '@/knowledge-content/keyword-retrievers/elastic-keyword-retriever.service';
import { PgKeywordRetrieverService } from '@/knowledge-content/keyword-retrievers/pg-keyword-retriever.service';
import type {
  KeywordRetrieveParams,
  KeywordRetrieveResult,
} from '@/knowledge-content/keyword-retrievers/keyword-retriever.interface';
import type { KeywordBackend } from '@/knowledge-content/types/knowledge-content.types';

@Injectable()
export class KnowledgeKeywordRetrieverService {
  private readonly logger = new Logger(KnowledgeKeywordRetrieverService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly elasticsearchIndexService: ElasticsearchIndexService,
    private readonly pgKeywordRetriever: PgKeywordRetrieverService,
    private readonly elasticKeywordRetriever: ElasticKeywordRetrieverService,
  ) {}

  async retrieve(
    params: KeywordRetrieveParams,
  ): Promise<KeywordRetrieveResult> {
    const preferredBackend = this.resolvePreferredBackend();
    const elasticsearchEnabled = this.elasticsearchIndexService.isEnabled();
    const initialBackend =
      preferredBackend === 'elastic' && elasticsearchEnabled ? 'elastic' : 'pg';
    const initialFallbackToPg =
      preferredBackend === 'elastic' && initialBackend === 'pg';

    return runInTracedScope(
      {
        name: 'knowledge_keyword_retrieve',
        runType: 'retriever',
        tags: ['knowledge', 'rag', 'retrieve', 'keyword'],
        metadata: {
          knowledgeId: params.knowledgeId,
          matchCount: params.matchCount,
          termCount: params.terms.length,
          preferredBackend,
        },
        input: {
          knowledgeId: params.knowledgeId,
          terms: params.terms,
        },
        outputProcessor: (output) => ({
          resultCount: output.chunks.length,
          backend: output.backend,
          fallbackToPg: output.fallbackToPg,
        }),
      },
      async () => {
        return this.retrieveWithFallback(
          params,
          initialBackend,
          initialFallbackToPg,
        );
      },
    );
  }

  private async retrieveWithFallback(
    params: KeywordRetrieveParams,
    backend: KeywordBackend,
    fallbackToPg: boolean,
  ): Promise<KeywordRetrieveResult> {
    if (backend === 'pg') {
      const chunks = await this.pgKeywordRetriever.retrieveChunks(params);
      return {
        chunks,
        backend: 'pg',
        fallbackToPg,
      };
    }

    try {
      const chunks = await this.elasticKeywordRetriever.retrieveChunks(params);
      return {
        chunks,
        backend: 'elastic',
        fallbackToPg,
      };
    } catch (error) {
      this.logger.warn(
        `ES 关键词检索失败，自动回退 PG：${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      const chunks = await this.pgKeywordRetriever.retrieveChunks(params);
      return {
        chunks,
        backend: 'pg',
        fallbackToPg: true,
      };
    }
  }

  private resolvePreferredBackend(): KeywordBackend {
    const value = String(
      this.configService.get<string>('HYBRID_KEYWORD_BACKEND') ??
        DEFAULT_HYBRID_KEYWORD_BACKEND,
    )
      .trim()
      .toLowerCase();

    return value === 'elastic' ? 'elastic' : 'pg';
  }
}
