import {
  getRagProfile,
  resolveHttpChatProfileId,
  resolveRealtimeProfileId,
  RAG_PROFILES,
} from '@/common/rag/rag-profile';
import { TurnBudgetContext } from '@/common/rag/turn-budget.context';

describe('RagProfile', () => {
  it('默认回退 balanced_chat', () => {
    expect(getRagProfile(undefined).id).toBe('balanced_chat');
    expect(getRagProfile('unknown').id).toBe('balanced_chat');
  });

  it('HTTP 默认 balanced，WS digital-human 为 realtime', () => {
    expect(resolveHttpChatProfileId()).toBe('balanced_chat');
    expect(resolveRealtimeProfileId('digital-human')).toBe('realtime_voice');
    expect(resolveRealtimeProfileId('voice')).toBe('realtime_voice');
  });

  it('realtime 默认关闭 web 与多跳', () => {
    const profile = RAG_PROFILES.realtime_voice;
    expect(profile.maxHops).toBe(1);
    expect(profile.allowWeb).toBe(false);
    expect(profile.evaluateMode).toBe('heuristic');
    expect(profile.rerankMode).toBe('score');
    expect(profile.budget.maxLlmCalls).toBe(2);
    expect(profile.useLongTermMemory).toBe(false);
    expect(profile.routeMode).toBe('heuristic');
  });

  it('balanced 开启长期记忆，realtime/search_debug 关闭', () => {
    expect(RAG_PROFILES.balanced_chat.useLongTermMemory).toBe(true);
    expect(RAG_PROFILES.deep_research.useLongTermMemory).toBe(true);
    expect(RAG_PROFILES.search_debug.useLongTermMemory).toBe(false);
    expect(RAG_PROFILES.balanced_chat.routeMode).toBe('llm');
  });
});

describe('TurnBudgetContext', () => {
  it('能限制 LLM 次数并记录 first token', () => {
    const budget = new TurnBudgetContext({
      wallClockMs: 10_000,
      maxLlmCalls: 2,
      maxEmbedCalls: 3,
    });
    expect(budget.tryConsumeLlm(1)).toBe(true);
    expect(budget.tryConsumeLlm(1)).toBe(true);
    expect(budget.tryConsumeLlm(1)).toBe(false);
    expect(budget.snapshotFlags()).toContain('budget_llm');
    budget.recordFirstTokenIfNeeded();
    expect(budget.firstTokenLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('前置 LLM 调用会为最终生成预留一次预算', () => {
    const budget = new TurnBudgetContext({
      wallClockMs: 10_000,
      maxLlmCalls: 5,
      maxEmbedCalls: 3,
    });
    expect(budget.tryConsumeAuxiliaryLlm()).toBe(true);
    expect(budget.tryConsumeAuxiliaryLlm()).toBe(true);
    expect(budget.tryConsumeAuxiliaryLlm()).toBe(true);
    expect(budget.tryConsumeAuxiliaryLlm()).toBe(true);
    expect(budget.tryConsumeAuxiliaryLlm()).toBe(false);
    expect(budget.snapshotFlags()).toContain(
      'budget_llm_reserved_for_generation',
    );
    expect(budget.tryConsumeLlm()).toBe(true);
    expect(budget.llmCalls).toBe(5);
  });
});
