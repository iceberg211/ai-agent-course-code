import { Injectable } from '@nestjs/common';
import type { estypes } from '@elastic/elasticsearch';
import { ElasticsearchIndexService } from '@/knowledge-content/elasticsearch/elasticsearch-index.service';
import type { KnowledgeChunkIndexDocument } from '@/knowledge-content/elasticsearch/elasticsearch.types';
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

    const should = normalizedTerms.flatMap((term) => [
      {
        match: {
          content: {
            query: term,
            boost: 4,
          },
        },
      },
      {
        match: {
          source: {
            query: term,
            boost: 2,
          },
        },
      },
      {
        match: {
          category: {
            query: term,
            boost: 2,
          },
        },
      },
      {
        match: {
          'content.ngram': {
            query: term,
            boost: 1.2,
          },
        },
      },
    ]);

    const response = await client.search<KnowledgeChunkIndexDocument>({
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
    });

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
