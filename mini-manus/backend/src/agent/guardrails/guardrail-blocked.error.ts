/**
 * Guardrail 链拦截时抛出的错误。
 * planner.node.ts 捕获后直接将 run 标记为 FAILED，不走 retry/replan。
 */
export class GuardrailBlockedError extends Error {
  constructor(
    public readonly reason: 'input_injection' | 'plan_injection',
    public readonly detail: string,
  ) {
    super(`Guardrail blocked: ${reason} — ${detail}`);
    this.name = 'GuardrailBlockedError';
  }
}
