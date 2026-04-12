import type { LLMResult } from '@langchain/core/outputs';
import { TokenTrackerCallback } from '@/agent/token-tracker.callback';

describe('TokenTrackerCallback', () => {
  it('累计 OpenAI tokenUsage 格式', async () => {
    const tracker = new TokenTrackerCallback();

    await tracker.handleLLMEnd({
      generations: [],
      llmOutput: {
        tokenUsage: {
          promptTokens: 12,
          completionTokens: 8,
        },
      },
    } as unknown as LLMResult);

    expect(tracker.inputTokens).toBe(12);
    expect(tracker.outputTokens).toBe(8);
    expect(tracker.totalTokens).toBe(20);
  });

  it('累计 Qwen usage 格式', async () => {
    const tracker = new TokenTrackerCallback();

    await tracker.handleLLMEnd({
      generations: [],
      llmOutput: {
        usage: {
          input_tokens: 30,
          output_tokens: 10,
        },
      },
    } as unknown as LLMResult);
    await tracker.handleLLMEnd({
      generations: [],
      llmOutput: {
        token_usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
        },
      },
    } as unknown as LLMResult);

    expect(tracker.inputTokens).toBe(35);
    expect(tracker.outputTokens).toBe(12);
    expect(tracker.totalTokens).toBe(47);
  });
});
