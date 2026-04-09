import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';

/**
 * 统计单次 Run 内所有 LLM 调用的 token 用量。
 *
 * 兼容多种 provider 的 usage 字段路径：
 *  - OpenAI / Azure：llmOutput.tokenUsage.{ promptTokens, completionTokens }
 *  - Qwen / DashScope：llmOutput.usage.{ input_tokens, output_tokens }
 *  - 宽松兜底：逐个字段名尝试，找到第一个非 0 值
 *
 * 用法：
 *   const tracker = new TokenTrackerCallback();
 *   await compiled.invoke(state, { callbacks: [tracker] });
 *   console.log(tracker.inputTokens, tracker.outputTokens);
 */
export class TokenTrackerCallback extends BaseCallbackHandler {
  name = 'TokenTrackerCallback';

  private _inputTokens = 0;
  private _outputTokens = 0;

  get inputTokens() {
    return this._inputTokens;
  }
  get outputTokens() {
    return this._outputTokens;
  }
  get totalTokens() {
    return this._inputTokens + this._outputTokens;
  }

  async handleLLMEnd(output: LLMResult): Promise<void> {
    const llmOut = output.llmOutput as Record<string, unknown> | undefined;
    if (!llmOut) return;

    // 尝试多条路径，取第一个有效值
    const usage =
      (llmOut['tokenUsage'] as Record<string, unknown> | undefined) ??
      (llmOut['usage'] as Record<string, unknown> | undefined) ??
      (llmOut['token_usage'] as Record<string, unknown> | undefined);

    if (!usage || typeof usage !== 'object') return;

    const inp =
      (usage['promptTokens'] as number | undefined) ??
      (usage['prompt_tokens'] as number | undefined) ??
      (usage['input_tokens'] as number | undefined) ??
      0;

    const out =
      (usage['completionTokens'] as number | undefined) ??
      (usage['completion_tokens'] as number | undefined) ??
      (usage['output_tokens'] as number | undefined) ??
      0;

    this._inputTokens += inp;
    this._outputTokens += out;
  }
}
