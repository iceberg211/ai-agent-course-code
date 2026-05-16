import { Injectable } from '@nestjs/common';
import type { estypes } from '@elastic/elasticsearch';
import { throwIfAborted } from '@/agent/agent.utils';
import { ElasticsearchIndexService } from '@/knowledge-content/elasticsearch/elasticsearch-index.service';
import type { KnowledgeChunkIndexDocument } from '@/knowledge-content/elasticsearch/elasticsearch.types';
import { buildElasticKeywordShouldClauses } from '@/knowledge-content/keyword-retrievers/elastic-keyword-query.builder';
import { normalizeKeywordTerms } from '@/knowledge-content/keyword-retrievers/keyword-retriever.utils';
import type {
  KeywordRetrieveParams,
  KeywordRetriever,
} from '@/knowledge-content/keyword-retrievers/keyword-retriever.interface';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

@Injectable()
export class ElasticKeywordRetrieverService implements KeywordRetriever {
  constructor(
    private readonly elasticsearchIndexService: ElasticsearchIndexService,
  ) {}

  async retrieveChunks(
    params: KeywordRetrieveParams,
  ): Promise<KnowledgeChunk[]> {
    throwIfAborted(params.signal);
    const normalizedTerms = normalizeKeywordTerms(params.terms);
    if (normalizedTerms.length === 0) {
      return [];
    }

    if (!this.elasticsearchIndexService.isEnabled()) {
      throw new Error(
        'ELASTICSEARCH_ENABLED=false，当前无法使用 ES 关键词检索',
      );
    }

    const client = this.elasticsearchIndexService.getClient();
    if (!client) {
      throw new Error('ES client 不可用');
    }

    await this.elasticsearchIndexService.ensureKnowledgeChunkIndex();

    const should = buildElasticKeywordShouldClauses(normalizedTerms, {
      useExactPhrase: params.useExactPhrase === true,
    });

    const searchRequest = {
      index: this.elasticsearchIndexService.getKnowledgeChunkReadAlias(),
      size: params.matchCount,
      query: {
        bool: {
          filter: [
            {
              term: {
                knowledge_base_id: params.knowledgeId,
              },
            },
            {
              term: {
                enabled: true,
              },
            },
          ],
          should,
          minimum_should_match: 1,
        },
      },
      sort: [{ _score: { order: 'desc' } }, { chunk_index: { order: 'asc' } }],
    } satisfies estypes.SearchRequest;
    const response = params.signal
      ? await client.search<KnowledgeChunkIndexDocument>(searchRequest, {
          signal: params.signal,
        })
      : await client.search<KnowledgeChunkIndexDocument>(searchRequest);
    throwIfAborted(params.signal);

    return this.mapResponseToChunks(response);
  }

  private mapResponseToChunks(
    response: estypes.SearchResponse<KnowledgeChunkIndexDocument>,
  ): KnowledgeChunk[] {
    return response.hits.hits
      .map((hit) => {
        const source = hit._source;
        const keywordScore = hit._score ?? 0;
        if (!source || !Number.isFinite(keywordScore) || keywordScore <= 0) {
          return null;
        }

        return {
          id: source.id,
          document_id: source.document_id,
          content: source.content,
          source: source.source,
          chunk_index: Number(source.chunk_index),
          category: source.category,
          similarity: 0,
          knowledge_base_id: source.knowledge_base_id,
          keyword_score: keywordScore,
          retrieval_sources: ['keyword'],
        } satisfies KnowledgeChunk;
      })
      .filter((chunk) => chunk !== null);
  }
}
