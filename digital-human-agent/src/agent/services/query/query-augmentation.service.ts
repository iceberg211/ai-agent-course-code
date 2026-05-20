import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_QUERY_REWRITE_MAX_EXPANSIONS } from '@/common/constants';
import { isAbortError } from '@/common/utils';
import { normalizeRetrievalStrategy } from '@/common/rag';
import type {
  RagQueryAugmentationPlan,
  RagStrategy,
} from '@/agent/types/rag-workflow.types';
import { QueryRewriteService } from '@/knowledge/services/retrieval/query-rewrite.service';
import type {
  KnowledgeQueryRewriteResult,
  RetrievalQueryItem,
} from '@/knowledge/types/knowledge-content.types';
import {
  containsGraphTerms,
  isGreeting,
  isExactLookup,
  isGraphQuestion,
} from '@/agent/utils/query-heuristic.utils';

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
    const fallbackRewrite = this.queryRewriteService.buildFallbackRewrite(
      normalizedQuestion,
      normalizedQuestion ? '使用原始问题检索' : '问题为空',
    );

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

    if (isGreeting(normalizedQuestion)) {
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

    const exactLike = isExactLookup(normalizedQuestion);
    const graphLike = isGraphQuestion(normalizedQuestion);
    const maxQueries =
      input.routeStrategy === 'complex' && !exactLike
        ? DEFAULT_QUERY_REWRITE_MAX_EXPANSIONS
        : 1;
    const rewrite =
      maxQueries > 1
        ? await this.tryRewrite(normalizedQuestion, fallbackRewrite, input.signal)
        : fallbackRewrite;

    const retrievalQueries = this.queryRewriteService.resolveRetrievalQueries(
      rewrite,
      maxQueries,
      {
        useMultiQuery: maxQueries > 1,
        preferOriginal: true,
      },
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
    if (containsGraphTerms(originalQuery)) {
      return true;
    }

    if (
      (rewrite.expandedQueries ?? []).some(
        (item) =>
          item.angle === 'entity' || containsGraphTerms(item.query),
      )
    ) {
      return true;
    }

    return retrievalQueries.some(
      (item) =>
        item.angle === 'entity' ||
        item.keywords.some((keyword) => containsGraphTerms(keyword)),
    );
  }
}
