import { AsyncLocalStorage } from 'node:async_hooks';
import { withTimeout } from '@/common/utils';

/**
 * 单轮 RAG 运行时预算：可变计数器 + wall-clock。
 * profile 上的 maxLlmCalls 等只是上限配置；真正限流靠本上下文。
 */
export class TurnBudgetContext {
  readonly startedAt: number;
  readonly wallClockMs: number;
  readonly maxLlmCalls: number;
  readonly maxEmbedCalls: number;
  /** 保留给最终回答生成的 LLM 次数，避免前置决策耗尽全部额度。 */
  readonly reservedLlmCallsForGeneration: number;

  llmCalls = 0;
  embedCalls = 0;
  firstTokenAt: number | null = null;
  readonly degradationFlags = new Set<string>();

  constructor(options: {
    startedAt?: number;
    wallClockMs: number;
    maxLlmCalls: number;
    maxEmbedCalls: number;
    reserveLlmCallsForGeneration?: number;
  }) {
    this.startedAt = options.startedAt ?? Date.now();
    this.wallClockMs = Math.max(1, options.wallClockMs);
    this.maxLlmCalls = Math.max(0, options.maxLlmCalls);
    this.maxEmbedCalls = Math.max(0, options.maxEmbedCalls);
    this.reservedLlmCallsForGeneration = Math.min(
      this.maxLlmCalls,
      Math.max(0, options.reserveLlmCallsForGeneration ?? 1),
    );
  }

  remainingWallClockMs(now = Date.now()): number {
    return Math.max(0, this.wallClockMs - (now - this.startedAt));
  }

  isWallClockExhausted(now = Date.now()): boolean {
    return this.remainingWallClockMs(now) <= 0;
  }

  canCallLlm(cost = 1): boolean {
    if (this.isWallClockExhausted()) {
      this.degradationFlags.add('budget_wall_clock');
      return false;
    }
    if (this.llmCalls + cost > this.maxLlmCalls) {
      this.degradationFlags.add('budget_llm');
      return false;
    }
    return true;
  }

  canEmbed(cost = 1): boolean {
    if (this.isWallClockExhausted()) {
      this.degradationFlags.add('budget_wall_clock');
      return false;
    }
    if (this.embedCalls + cost > this.maxEmbedCalls) {
      this.degradationFlags.add('budget_embed');
      return false;
    }
    return true;
  }

  recordLlm(cost = 1): void {
    this.llmCalls += cost;
  }

  recordEmbed(cost = 1): void {
    this.embedCalls += cost;
  }

  /** 在真正发起 LLM 前：有额度则占坑并返回 true */
  tryConsumeLlm(cost = 1): boolean {
    if (!this.canCallLlm(cost)) return false;
    this.recordLlm(cost);
    return true;
  }

  /**
   * 路由、改写、重排、评估等前置 LLM 调用。
   * 必须为最终 generate 保留至少一次额度；无可用预算上下文时由调用方直接放行。
   */
  tryConsumeAuxiliaryLlm(cost = 1): boolean {
    if (!this.canCallLlm(cost)) return false;
    if (
      this.llmCalls + cost >
      this.maxLlmCalls - this.reservedLlmCallsForGeneration
    ) {
      this.degradationFlags.add('budget_llm_reserved_for_generation');
      return false;
    }
    this.recordLlm(cost);
    return true;
  }

  tryConsumeEmbed(cost = 1): boolean {
    if (!this.canEmbed(cost)) return false;
    this.recordEmbed(cost);
    return true;
  }

  recordFirstTokenIfNeeded(now = Date.now()): void {
    if (this.firstTokenAt == null) {
      this.firstTokenAt = now;
    }
  }

  get firstTokenLatencyMs(): number | null {
    if (this.firstTokenAt == null) return null;
    return Math.max(0, this.firstTokenAt - this.startedAt);
  }

  isExhausted(now = Date.now()): boolean {
    return (
      this.isWallClockExhausted(now) ||
      this.llmCalls >= this.maxLlmCalls ||
      this.embedCalls >= this.maxEmbedCalls
    );
  }

  addDegradation(flag: string): void {
    if (flag.trim()) this.degradationFlags.add(flag.trim());
  }

  snapshotFlags(): string[] {
    return Array.from(this.degradationFlags).sort();
  }
}

const turnBudgetStorage = new AsyncLocalStorage<TurnBudgetContext>();

export function runWithTurnBudget<T>(
  budget: TurnBudgetContext,
  fn: () => Promise<T>,
): Promise<T> {
  return turnBudgetStorage.run(budget, fn);
}

export function getTurnBudget(): TurnBudgetContext | undefined {
  return turnBudgetStorage.getStore();
}

/** 无 budget 时放行（单测 / 非 agent 路径） */
export function tryConsumeLlmBudget(cost = 1): boolean {
  const budget = getTurnBudget();
  if (!budget) return true;
  return budget.tryConsumeLlm(cost);
}

/** 前置决策类 LLM 调用；保留最终 generate 的预算。 */
export function tryConsumeAuxiliaryLlmBudget(cost = 1): boolean {
  const budget = getTurnBudget();
  if (!budget) return true;
  return budget.tryConsumeAuxiliaryLlm(cost);
}

export function tryConsumeEmbedBudget(cost = 1): boolean {
  const budget = getTurnBudget();
  if (!budget) return true;
  return budget.tryConsumeEmbed(cost);
}

export function recordFirstTokenBudget(): void {
  getTurnBudget()?.recordFirstTokenIfNeeded();
}

export function addTurnDegradation(flag: string): void {
  getTurnBudget()?.addDegradation(flag);
}

/**
 * 将外部调用限定在本轮剩余 wall-clock 内。
 * 若调用方主动取消则保持 AbortError；预算超时由上层按降级策略处理。
 */
export function withRemainingTurnTimeout<T>(
  operation: string,
  fn: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const budget = getTurnBudget();
  const timeoutMs = budget?.remainingWallClockMs();
  if (timeoutMs !== undefined && timeoutMs <= 0) {
    budget?.addDegradation('budget_wall_clock');
  }
  return withTimeout(operation, fn, {
    signal,
    timeoutMs: timeoutMs === undefined ? undefined : Math.max(1, timeoutMs),
    timeoutMessage: `${operation} 超过本轮 wall-clock 预算`,
  });
}
