import { Injectable } from '@nestjs/common';
import { normalizeRetrievalStrategy } from '@/common/rag/retrieval-strategy.utils';
import {
  getRagProfile,
  type RagProfile,
  type RagProfileId,
} from '@/common/rag/rag-profile';
import type {
  RagQueryAugmentationPlan,
  RagStrategy,
} from '@/agent/types/rag-workflow.types';
import { QueryAugmentationService } from '@/agent/services/query-augmentation.service';
import type { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import {
  addTurnDegradation,
  getTurnBudget,
} from '@/common/rag/turn-budget.context';

export interface ResolvedRetrievalPlan extends RagQueryAugmentationPlan {
  profileId: RagProfileId;
  profile: RagProfile;
}

/**
 * 用 Profile 约束包住现有 QueryAugmentationService，不替换其内部 rewrite/追问逻辑。
 */
@Injectable()
export class RetrievalPolicyResolver {
  constructor(
    private readonly queryAugmentationService: QueryAugmentationService,
  ) {}

  async resolve(input: {
    question: string;
    routeStrategy: RagStrategy;
    profileId?: string | null;
    history?: ConversationMessage[];
    signal?: AbortSignal;
  }): Promise<ResolvedRetrievalPlan> {
    const profile = getRagProfile(input.profileId);

    // profile 禁止 multi-query 时，按 simple 路径跑 augmentation，避免 LLM rewrite
    let routeForAugmentation: RagStrategy =
      profile.useMultiQuery === false && input.routeStrategy === 'complex'
        ? 'simple'
        : input.routeStrategy;

    // rewriteMode 非 llm，或 LLM 预算不足：强制 simple（启发式 rewrite）
    if (profile.rewriteMode !== 'llm' || !this.hasLlmBudget()) {
      if (profile.rewriteMode === 'llm' && routeForAugmentation === 'complex') {
        addTurnDegradation('budget_llm');
        addTurnDegradation('rewrite_heuristic');
      }
      routeForAugmentation = 'simple';
    }

    const plan = await this.queryAugmentationService.plan({
      question: input.question,
      routeStrategy: routeForAugmentation,
      history: input.history,
      signal: input.signal,
    });

    const constrained = this.applyProfileConstraints(plan, profile);
    return {
      ...constrained,
      profileId: profile.id,
      profile,
    };
  }

  private hasLlmBudget(): boolean {
    const budget = getTurnBudget();
    if (!budget) return true;
    return budget.canCallLlm(1);
  }

  private applyProfileConstraints(
    plan: RagQueryAugmentationPlan,
    profile: RagProfile,
  ): RagQueryAugmentationPlan {
    let queries = plan.retrievalQueries;
    if (!profile.useMultiQuery && queries.length > 1) {
      queries = queries.slice(0, 1);
    }

    const useGraph =
      profile.useGraphChannel && plan.strategy.useGraph === true;
    const allowWeb = profile.allowWeb && plan.strategy.allowWeb !== false;

    const strategy = normalizeRetrievalStrategy({
      ...plan.strategy,
      useGraph,
      allowWeb,
      useMultiQuery: profile.useMultiQuery && queries.length > 1,
      queryCount: Math.max(queries.length, 1),
      reason: `${plan.strategy.reason} | profile=${profile.id}`,
    });

    return {
      ...plan,
      retrievalQueries: queries,
      currentQuery: queries[0]?.query ?? plan.currentQuery,
      strategy,
    };
  }
}
