import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { estypes } from '@elastic/elasticsearch';
import { runInTracedScope } from '@/common/langsmith/langsmith.utils';
import { DEFAULT_HYBRID_KEYWORD_BACKEND } from '@/common/constants';
import { ElasticsearchIndexService } from '@/knowledge-content/elasticsearch/elasticsearch-index.service';
import type { KnowledgeChunkIndexDocument } from '@/knowledge-content/elasticsearch/elasticsearch-index.service';
import { throwIfAborted } from '@/common/utils';
import { KnowledgeChunk as KnowledgeChunkEntity } from '@/knowledge-content/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge-content/entities/knowledge-document.entity';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

// ==========================================
// 接口与类型定义
// ==========================================

export type KeywordBackend = 'pg' | 'elastic';

export interface KeywordRetrieveParams {
  knowledgeId: string;
  terms: string[];
  matchCount: number;
  useExactPhrase?: boolean;
  signal?: AbortSignal;
}

export interface KeywordRetrieveResult {
  chunks: KnowledgeChunk[];
  backend: KeywordBackend;
  fallbackToPg: boolean;
}

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
// 辅助纯函数 (以前在 utils & query builder 里)
// ==========================================

const FALLBACK_KEYWORD_PUNCTUATION =
  /[，。！？；：、“”‘’（）()【】\[\],.!?;:]/g;
const FALLBACK_KEYWORD_CJK_STOP_PHRASES =
  /(请问|帮我|告诉我|示例|哪些|哪个|什么|如何|怎么|为何|为什么|是否|是不是|有没有|是什么|怎么办|处理|一下)/g;
const FALLBACK_KEYWORD_CJK_BOUNDARIES =
  /[的得地了吗呢啊吧里中上下一后前为与和及或对把将应需可该]/g;
const CJK_CHARACTER = /[\u3400-\u9fff]/;

export function normalizeKeywordTerms(terms: string[]): string[] {
  return Array.from(
    new Set(
      terms
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
        .sort((left, right) => right.length - left.length),
    ),
  ).slice(0, 8);
}

export function escapeLike(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function extractFallbackKeywordTerms(query: string): string[] {
  const trimmedQuery = query.trim();
  const tokens = trimmedQuery
    .replace(FALLBACK_KEYWORD_PUNCTUATION, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  const terms = tokens.flatMap((token) => splitFallbackKeywordToken(token));
  const deduped = Array.from(
    new Set(terms.map((term) => term.trim()).filter((term) => term.length >= 2)),
  ).slice(0, 8);

  return deduped.length > 0 ? deduped : trimmedQuery ? [trimmedQuery] : [];
}

function splitFallbackKeywordToken(token: string): string[] {
  if (!CJK_CHARACTER.test(token)) return [token];
  if (token.length <= 8) return [token];

  const parts = token
    .replace(FALLBACK_KEYWORD_CJK_STOP_PHRASES, ' ')
    .replace(FALLBACK_KEYWORD_CJK_BOUNDARIES, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  const terms = parts.flatMap((part) =>
    part.length <= 8 ? [part] : splitLongCjkTerm(part),
  );

  return terms.length > 0 ? terms : [token.slice(0, 8)];
}

function splitLongCjkTerm(term: string): string[] {
  const terms: string[] = [];
  for (const size of [6, 5, 4, 3, 2]) {
    for (let index = 0; index + size <= term.length; index += 1) {
      const candidate = term.slice(index, index + size);
      if (!CJK_CHARACTER.test(candidate) || terms.includes(candidate)) continue;
      terms.push(candidate);
      if (terms.length >= 6) return terms;
    }
  }

  return terms;
}

function buildElasticKeywordShouldClauses(
  terms: string[],
  options: { useExactPhrase: boolean },
) {
  return terms.flatMap((term) =>
    [
      options.useExactPhrase
        ? {
            match_phrase: {
              content: {
                query: term,
                boost: 8,
              },
            },
          }
        : null,
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
    ].filter((query) => query !== null),
  );
}

// ==========================================
// 核心 Service 实现
// ==========================================

@Injectable()
export class KnowledgeKeywordRetrieverService {
  private readonly logger = new Logger(KnowledgeKeywordRetrieverService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly elasticsearchIndexService: ElasticsearchIndexService,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepo: Repository<KnowledgeChunkEntity>,
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
      const chunks = await this.pgRetrieve(params);
      return {
        chunks,
        backend: 'pg',
        fallbackToPg,
      };
    }

    try {
      const chunks = await this.elasticRetrieve(params);
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

      const chunks = await this.pgRetrieve(params);
      return {
        chunks,
        backend: 'pg',
        fallbackToPg: true,
      };
    }
  }

  // ==========================================
  // PG 关键词检索实现
  // ==========================================
  private async pgRetrieve(
    params: KeywordRetrieveParams,
  ): Promise<KnowledgeChunk[]> {
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
    const rows = await this.chunkRepo
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
      .andWhere(`(${matchClauses.join(' OR ')})`)
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
          retrieval_sources: ['keyword'],
        } satisfies KnowledgeChunk;
      })
      .filter((chunk) => chunk !== null) as KnowledgeChunk[];
  }

  // ==========================================
  // ES 关键词检索实现
  // ==========================================
  private async elasticRetrieve(
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
