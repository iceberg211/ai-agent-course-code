import { Injectable } from '@nestjs/common';
import { throwIfAborted } from '@/common/utils';
import { normalizeRetrievalStrategy } from '@/common/rag';
import type {
  RagRetrievalStrategyDecision,
  RagStrategy,
} from '@/agent/types/rag-workflow.types';

@Injectable()
export class RetrievalStrategyService {
  async plan(
    input: {
      question: string;
      currentQuery: string;
      routeStrategy: RagStrategy;
      remainingHops: number;
    },
    signal?: AbortSignal,
  ): Promise<RagRetrievalStrategyDecision> {
    throwIfAborted(signal);

    const query = (input.currentQuery || input.question).trim();
    if (!query || this.isGreeting(query)) {
      return normalizeRetrievalStrategy({
        needRetrieval: false,
        useVector: false,
        useKeyword: false,
        useGraph: false,
        useExactPhrase: false,
        useMultiQuery: false,
        allowWeb: false,
        chunkContextWindow: 0,
        reason: query ? '寒暄问题，不需要查知识库' : '问题为空，跳过检索',
      });
    }

    const exactLike = this.isExactLookup(query);
    const graphLike = this.isGraphQuestion(query);
    const useMultiQuery = input.routeStrategy === 'complex' || !exactLike;

    return normalizeRetrievalStrategy({
      needRetrieval: true,
      useVector: true,
      useKeyword: true,
      useGraph: graphLike,
      useExactPhrase: exactLike,
      useMultiQuery,
      allowWeb: true,
      queryCount: useMultiQuery ? 3 : 1,
      chunkContextWindow: 0,
      graphMode: graphLike ? 'path' : undefined,
      graphMaxHops: graphLike ? 2 : undefined,
      reason: graphLike
        ? '命中关系类问题，使用本地混合检索和 Neo4j 图谱扩展'
        : useMultiQuery
          ? '使用本地混合检索和多路 query rewrite'
          : '使用本地混合检索和精确短语权重',
    });
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
    return /关系|关联|包含子主题|层级|上下游|依赖|参与方|甲方|乙方|流程/u.test(
      query,
    );
  }
}
