import { EvaluationResult } from '@/agent/agent.state';
import { TokenTrackerCallback } from '@/agent/token-tracker.callback';

export const TOKEN_BUDGET_EXCEEDED = 'token_budget_exceeded';

export class TokenBudgetGuard {
  constructor(
    private readonly tracker: TokenTrackerCallback,
    private readonly budget: number,
    private readonly estimateCostUsd: () => number | null,
  ) {}

  check(): EvaluationResult | null {
    if (!Number.isFinite(this.budget) || this.budget <= 0) return null;
    if (this.tracker.totalTokens <= this.budget) return null;

    const estimatedCostUsd = this.estimateCostUsd();
    return {
      decision: 'fail',
      reason: `Token 预算已耗尽：已使用 ${this.tracker.totalTokens} / ${this.budget} tokens`,
      errorCode: TOKEN_BUDGET_EXCEEDED,
      metadata: {
        budget: this.budget,
        usedTokens: this.tracker.totalTokens,
        inputTokens: this.tracker.inputTokens,
        outputTokens: this.tracker.outputTokens,
        estimatedCostUsd,
      },
    };
  }
}
