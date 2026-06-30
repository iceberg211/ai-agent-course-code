import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import type { estypes } from '@elastic/elasticsearch';
import { throwIfAborted } from '@/common/utils';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { DEFAULT_HYBRID_KEYWORD_BACKEND } from '@/common/constants';
import { ElasticsearchIndexService } from '@/knowledge/elasticsearch/elasticsearch-index.service';
import type { KnowledgeChunkIndexDocument } from '@/knowledge/elasticsearch/elasticsearch-index.service';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import {
  normalizeKeywordTerms,
  escapeLike,
  extractFallbackKeywordTerms,
} from '@/knowledge/utils/keyword.utils';
import type {
  KeywordBackend,
  KnowledgeAccessScope,
  KnowledgeChunk,
} from '@/knowledge/types/knowledge-content.types';
import { applyDocumentAccessScope } from '@/knowledge/utils/document-access.util';

// Re-export for backward compatibility with existing consumers
export { normalizeKeywordTerms, escapeLike, extractFallbackKeywordTerms } from '@/knowledge/utils/keyword.utils';

function buildElasticKeywordShouldClauses(
  terms: string[],
  options: { useExactPhrase: boolean },
): estypes.QueryDslQueryContainer[] {
  return terms.flatMap((term) => {
    const clauses: estypes.QueryDslQueryContainer[] = [];
    if (options.useExactPhrase) {
      clauses.push({
        match_phrase: {
          content: {
            query: term,
            boost: 8,
          },
        },
      });
    }
    clauses.push(
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
        term: {
          'source.keyword': {
            value: term,
            boost: 3,
          },
        },
      },
      {
        term: {
          'category.keyword': {
            value: term,
            boost: 3,
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
    );
    return clauses;
  });
}

// ==========================================
// PG 检索行类型
// ==========================================

interface KeywordRow {
  id: string;
  content: string;
  source: string;
  chunk_index: string | number;
  category: string | null;
  knowledge_base_id: string;
  keyword_score: string | number;
}

// ==========================================
// FulltextRetrieverService
// ==========================================

@Injectable()
export class FulltextRetrieverService {
  private readonly logger = new Logger(FulltextRetrieverService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly elasticsearchIndexService: ElasticsearchIndexService,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
  ) {}

  async retrieve(params: {
    knowledgeId: string;
    terms: string[];
    matchCount: number;
    useExactPhrase?: boolean;
    accessScope?: KnowledgeAccessScope;
    signal?: AbortSignal;
  }): Promise<{
    chunks: KnowledgeChunk[];
    backend: KeywordBackend;
    fallbackToPg: boolean;
  }> {
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
    params: {
      knowledgeId: string;
      terms: string[];
      matchCount: number;
      useExactPhrase?: boolean;
      accessScope?: KnowledgeAccessScope;
      signal?: AbortSignal;
    },
    backend: KeywordBackend,
    fallbackToPg: boolean,
  ): Promise<{
    chunks: KnowledgeChunk[];
    backend: KeywordBackend;
    fallbackToPg: boolean;
  }> {
    if (backend === 'pg') {
      const chunks = await this.pgRetrieve(params);
      return { chunks, backend: 'pg', fallbackToPg };
    }

    try {
      const chunks = await this.elasticRetrieve(params);
      if (chunks.length === 0) {
        const pgChunks = await this.pgRetrieve(params);
        if (pgChunks.length > 0) {
          return { chunks: pgChunks, backend: 'pg', fallbackToPg: true };
        }
      }
      return { chunks, backend: 'elastic', fallbackToPg };
    } catch (error) {
      this.logger.warn(
        `ES 关键词检索失败，自动回退 PG：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      const chunks = await this.pgRetrieve(params);
      return { chunks, backend: 'pg', fallbackToPg: true };
    }
  }

  private async pgRetrieve(params: {
    knowledgeId: string;
    terms: string[];
    matchCount: number;
    accessScope?: KnowledgeAccessScope;
    signal?: AbortSignal;
  }): Promise<KnowledgeChunk[]> {
    throwIfAborted(params.signal);
    const normalizedTerms = normalizeKeywordTerms(params.terms);
    if (normalizedTerms.length === 0) {
      return [];
    }

    const parameters: Record<string, string | number> = {
      knowledgeId: params.knowledgeId,
    };
    const scoreClauses: string[] = [];
    const matchClauses: string[] = [];

    normalizedTerms.forEach((term, index) => {
      const likeParam = `term${index}`;
      parameters[likeParam] = `%${escapeLike(term)}%`;

      const baseWeight = Math.min(8, Math.max(2, term.length));
      const contentWeight = baseWeight * 3;
      const sourceWeight = Math.max(2, Math.round(baseWeight * 1.5));
      const categoryWeight = Math.max(1, Math.round(baseWeight * 1.2));

      scoreClauses.push(
        `CASE WHEN chunk.content ILIKE :${likeParam} ESCAPE '\\' THEN ${contentWeight} ELSE 0 END`,
      );
      scoreClauses.push(
        `CASE WHEN chunk.source ILIKE :${likeParam} ESCAPE '\\' THEN ${sourceWeight} ELSE 0 END`,
      );
      scoreClauses.push(
        `CASE WHEN COALESCE(chunk.category, '') ILIKE :${likeParam} ESCAPE '\\' THEN ${categoryWeight} ELSE 0 END`,
      );

      matchClauses.push(
        `chunk.content ILIKE :${likeParam} ESCAPE '\\'`,
        `chunk.source ILIKE :${likeParam} ESCAPE '\\'`,
        `COALESCE(chunk.category, '') ILIKE :${likeParam} ESCAPE '\\'`,
      );
    });

    const scoreSql = `(${scoreClauses.join(' + ')})`;
    const qb = this.chunkRepo
      .createQueryBuilder('chunk')
      .innerJoin(
        KnowledgeDocument,
        'document',
        'document.id = chunk.document_id',
      )
      .select('chunk.id', 'id')
      .addSelect('chunk.content', 'content')
      .addSelect('chunk.source', 'source')
      .addSelect('chunk.chunk_index', 'chunk_index')
      .addSelect('chunk.category', 'category')
      .addSelect('document.knowledge_base_id', 'knowledge_base_id')
      .addSelect(scoreSql, 'keyword_score')
      .where('document.knowledge_base_id = :knowledgeId', {
        knowledgeId: params.knowledgeId,
      })
      .andWhere('chunk.enabled = true')
      .andWhere('document.is_current_version = true')
      .andWhere('document.archived_at IS NULL')
      .andWhere(`(${matchClauses.join(' OR ')})`);
    applyDocumentAccessScope(qb, 'document', params.accessScope);
    const rows = await qb
      .orderBy('keyword_score', 'DESC')
      .addOrderBy('chunk.chunk_index', 'ASC')
      .limit(params.matchCount)
      .setParameters(parameters)
      .getRawMany<KeywordRow>();
    throwIfAborted(params.signal);

    return rows
      .map((row) => {
        const keywordScore = Number(row.keyword_score);
        if (!Number.isFinite(keywordScore) || keywordScore <= 0) {
          return null;
        }

        return {
          id: row.id,
          content: row.content,
          source: row.source,
          chunk_index: Number(row.chunk_index),
          category: row.category,
          similarity: 0,
          knowledge_base_id: row.knowledge_base_id,
          keyword_score: keywordScore,
          retrieval_sources: ['keyword' as const],
        } satisfies KnowledgeChunk;
      })
      .filter((chunk) => chunk !== null) as KnowledgeChunk[];
  }

  private async elasticRetrieve(params: {
    knowledgeId: string;
    terms: string[];
    matchCount: number;
    useExactPhrase?: boolean;
    accessScope?: KnowledgeAccessScope;
    signal?: AbortSignal;
  }): Promise<KnowledgeChunk[]> {
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
            { term: { knowledge_base_id: params.knowledgeId } },
            { term: { enabled: true } },
            ...this.buildElasticAccessFilter(params.accessScope),
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

    const chunks = this.mapResponseToChunks(response);
      return this.filterExistingChunks(
        params.knowledgeId,
        chunks,
        params.accessScope,
      );
  }

  private buildElasticAccessFilter(
    accessScope?: KnowledgeAccessScope,
  ): estypes.QueryDslQueryContainer[] {
    if (!accessScope || accessScope.role === 'admin') return [];

    const should: estypes.QueryDslQueryContainer[] = [
      { term: { security_level: 0 } },
    ];
    if (accessScope.ownerId) {
      should.push({ term: { allowed_user_ids: accessScope.ownerId } });
    }
    if (accessScope.department) {
      should.push({
        term: { allowed_department_ids: accessScope.department },
      });
    }
    if (accessScope.role) {
      should.push({ term: { allowed_role_ids: accessScope.role } });
    }

    return [
      {
        bool: {
          should,
          minimum_should_match: 1,
        },
      },
    ];
  }

  private async filterExistingChunks(
    knowledgeId: string,
    chunks: KnowledgeChunk[],
    accessScope?: KnowledgeAccessScope,
  ): Promise<KnowledgeChunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    const scoreById = new Map(
      chunks.map((chunk) => [chunk.id, chunk.keyword_score ?? 0]),
    );
    const rows = await this.chunkRepo.find({
      where: {
        id: In(chunks.map((chunk) => chunk.id)),
        enabled: true,
        document: {
          knowledgeBaseId: knowledgeId,
          isCurrentVersion: true,
          archivedAt: IsNull(),
        },
      },
      relations: { document: true },
    });
    const visibleRows =
      accessScope?.role === 'admin'
        ? rows
        : rows.filter((row) => {
            const doc = row.document;
            if (!doc) return true;
            if (doc.visibility === 'company') return true;
            if (doc.visibility === 'department') {
              return Boolean(
                accessScope?.department && doc.department === accessScope.department,
              );
            }
            return Boolean(accessScope?.ownerId && doc.ownerId === accessScope.ownerId);
          });
    const existingById = new Map(visibleRows.map((row) => [row.id, row]));

    return chunks
      .map((chunk): KnowledgeChunk | null => {
        const row = existingById.get(chunk.id);
        if (!row) return null;
        return {
          ...chunk,
          document_id: row.documentId,
          content: row.content,
          source: row.source,
          chunk_index: row.chunkIndex,
          category: row.category,
          knowledge_base_id: knowledgeId,
          keyword_score: scoreById.get(chunk.id) ?? chunk.keyword_score,
        } satisfies KnowledgeChunk;
      })
      .filter((chunk): chunk is KnowledgeChunk => chunk !== null);
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
          retrieval_sources: ['keyword' as const],
        } satisfies KnowledgeChunk;
      })
      .filter((chunk) => chunk !== null) as KnowledgeChunk[];
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
