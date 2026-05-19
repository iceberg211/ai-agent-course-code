import { Injectable, Logger } from '@nestjs/common';
import { isAbortError } from '@/common/utils';
import { normalizeRetrievalStrategy } from '@/common/rag';
import type {
  RagQueryAugmentationPlan,
  RagStrategy,
} from '@/agent/types/rag-workflow.types';
import { QueryRewriteService } from '@/knowledge-content/services/query-rewrite.service';
import type {
  KnowledgeQueryRewriteResult,
  RetrievalQueryItem,
} from '@/knowledge-content/types/knowledge-content.types';
import { extractFallbackKeywordTerms } from '@/knowledge-content/keyword-retrievers/keyword-retriever.utils';

@Injectable()
export class QueryAugmentationService {
  private readonly logger = new Logger(QueryAugmentationService.name);

  constructor(private readonly queryRewriteService: QueryRewriteService) {}

  async plan(input: {
    question: string;
    routeStrategy: RagStrategy;
    signal?: AbortSignal;
  }): Promise<RagQueryAugmentationPlan> {
    const normalizedQuestion = input.question.trim();
    const fallbackRewrite = this.buildFallbackRewrite(normalizedQuestion);

    if (!normalizedQuestion) {
      return {
        rewrite: fallbackRewrite,
        retrievalQueries: [],
        currentQuery: '',
        strategy: normalizeRetrievalStrategy({
          needRetrieval: false,
          useVector: false,
          useKeyword: false,
          useGraph: false,
          useExactPhrase: false,
          useMultiQuery: false,
          allowWeb: false,
          queryCount: 1,
          reason: '问题为空，跳过检索',
        }),
      };
    }

    if (this.isGreeting(normalizedQuestion)) {
      return {
        rewrite: fallbackRewrite,
        retrievalQueries: [
          {
            index: 0,
            query: normalizedQuestion,
            keywords: fallbackRewrite.keywords,
            angle: 'original',
          },
        ],
        currentQuery: normalizedQuestion,
        strategy: normalizeRetrievalStrategy({
          needRetrieval: false,
          useVector: false,
          useKeyword: false,
          useGraph: false,
          useExactPhrase: false,
          useMultiQuery: false,
          allowWeb: false,
          queryCount: 1,
          reason: '寒暄问题，不需要查知识库',
        }),
      };
    }

    const exactLike = this.isExactLookup(normalizedQuestion);
    const graphLike = this.isGraphQuestion(normalizedQuestion);
    const maxQueries =
      input.routeStrategy === 'complex' && !exactLike ? 3 : 1;
    const rewrite =
      maxQueries > 1
        ? await this.tryRewrite(normalizedQuestion, fallbackRewrite, input.signal)
        : fallbackRewrite;
    const retrievalQueries = this.buildRetrievalQueries(
      normalizedQuestion,
      rewrite,
      maxQueries,
    );
    const hasAugmentedGraphHints = this.hasAugmentedGraphHints(
      normalizedQuestion,
      rewrite,
      retrievalQueries,
    );

    return {
      rewrite,
      retrievalQueries,
      currentQuery: retrievalQueries[0]?.query ?? normalizedQuestion,
      strategy: normalizeRetrievalStrategy({
        needRetrieval: true,
        useVector: true,
        useKeyword: true,
        useGraph: graphLike || hasAugmentedGraphHints,
        useExactPhrase: exactLike,
        useMultiQuery: retrievalQueries.length > 1,
        allowWeb: true,
        queryCount: retrievalQueries.length,
        chunkContextWindow: 0,
        graphMode: graphLike ? 'path' : 'neighbors',
        graphMaxHops: graphLike ? 2 : 1,
        reason: graphLike
          ? '关系类问题，启用 Neo4j 补充召回'
          : retrievalQueries.length > 1
            ? '复杂问题，使用多路 query 检索'
            : '单轮本地混合检索',
      }),
    };
  }

  private buildRetrievalQueries(
    originalQuery: string,
    rewrite: KnowledgeQueryRewriteResult,
    maxQueries: number,
  ): RetrievalQueryItem[] {
    const seen = new Set<string>();
    const queries: RetrievalQueryItem[] = [];

    const pushQuery = (item: {
      query: string;
      keywords: string[];
      angle: RetrievalQueryItem['angle'];
    }) => {
      const query = item.query.trim();
      if (!query || queries.length >= maxQueries) {
        return;
      }

      const key = query.toLowerCase();
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      queries.push({
        index: queries.length,
        query,
        keywords: item.keywords,
        angle: item.angle,
      });
    };

    pushQuery({
      query: originalQuery,
      keywords: this.extractKeywords(originalQuery),
      angle: 'original',
    });
    pushQuery({
      query: rewrite.rewrittenQuery,
      keywords: rewrite.keywords,
      angle: 'semantic',
    });

    for (const item of rewrite.expandedQueries ?? []) {
      pushQuery(item);
      if (queries.length >= maxQueries) {
        break;
      }
    }

    if (queries.length === 0 && originalQuery) {
      queries.push({
        index: 0,
        query: originalQuery,
        keywords: this.extractKeywords(originalQuery),
        angle: 'original',
      });
    }

    return queries;
  }

  private buildFallbackRewrite(query: string): KnowledgeQueryRewriteResult {
    const keywords = this.extractKeywords(query);
    return {
      originalQuery: query,
      rewrittenQuery: query,
      keywords,
      expandedQueries: query
        ? [
            {
              index: 0,
              query,
              keywords,
              angle: 'original',
            },
          ]
        : [],
      changed: false,
      reason: query ? '使用原始问题检索' : '问题为空',
    };
  }

  private extractKeywords(query: string): string[] {
    return extractFallbackKeywordTerms(query).slice(0, 6);
  }

  private async tryRewrite(
    question: string,
    fallbackRewrite: KnowledgeQueryRewriteResult,
    signal?: AbortSignal,
  ): Promise<KnowledgeQueryRewriteResult> {
    try {
      return await this.queryRewriteService.rewrite(question, signal);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      this.logger.warn(
        `Query Rewrite 失败，回退原始问题：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallbackRewrite;
    }
  }

  private hasAugmentedGraphHints(
    originalQuery: string,
    rewrite: KnowledgeQueryRewriteResult,
    retrievalQueries: RetrievalQueryItem[],
  ): boolean {
    if (this.containsGraphTerms(originalQuery)) {
      return true;
    }

    if (
      (rewrite.expandedQueries ?? []).some(
        (item) =>
          item.angle === 'entity' || this.containsGraphTerms(item.query),
      )
    ) {
      return true;
    }

    return retrievalQueries.some(
      (item) =>
        item.angle === 'entity' ||
        item.keywords.some((keyword) => this.containsGraphTerms(keyword)),
    );
  }

  private containsGraphTerms(text: string): boolean {
    return /关系|关联|包含|层级|上下游|依赖|参与方|甲方|乙方|流程/u.test(
      text,
    );
  }

  private isGreeting(query: string): boolean {
    return /^(你好|您好|嗨|hi|hello|哈喽|谢谢|多谢)[。！!？?]*$/iu.test(
      query.replace(/\s+/g, ''),
    );
  }

  private isExactLookup(query: string): boolean {
    return /《|》|"|'|\.md|\.txt|编号|订单|合同|条款|第.+章|第.+条/u.test(
      query,
    );
  }

  private isGraphQuestion(query: string): boolean {
    return this.containsGraphTerms(query);
  }
}
