import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';

export interface NodeTokenUsage {
  nodeName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number | null;
}

/**
 * 统计单次 Run 内所有 LLM 调用的 token 用量。
 *
 * 功能：
 *  1. Run 级聚合（inputTokens / outputTokens / totalTokens）
 *  2. 节点级明细（通过 withTag(nodeName) 标记当前调用节点）
 *
 * 用法：
 *   const tracker = new TokenTrackerCallback();
 *   // 在 planner 调用前：
 *   tracker.setCurrentNode('planner');
 *   await chain.invoke(..., { callbacks: [tracker] });
 *   tracker.clearCurrentNode();
 *
 * 兼容多种 provider 的 usage 字段路径：
 *  - OpenAI / Azure：llmOutput.tokenUsage.{ promptTokens, completionTokens }
 *  - Qwen / DashScope：llmOutput.usage.{ input_tokens, output_tokens }
 */
export class TokenTrackerCallback extends BaseCallbackHandler {
  name = 'TokenTrackerCallback';

  private _inputTokens = 0;
  private _outputTokens = 0;
  private _currentNode: string | null = null;
  private _nodeUsages: NodeTokenUsage[] = [];
  private _nodeStartMs: number | null = null;

  get inputTokens() { return this._inputTokens; }
  get outputTokens() { return this._outputTokens; }
  get totalTokens() { return this._inputTokens + this._outputTokens; }
  get nodeUsages(): readonly NodeTokenUsage[] { return this._nodeUsages; }

  /** 标记接下来的 LLM 调用属于哪个节点 */
  setCurrentNode(nodeName: string): void {
    this._currentNode = nodeName;
    this._nodeStartMs = Date.now();
  }

  clearCurrentNode(): void {
    this._currentNode = null;
    this._nodeStartMs = null;
  }

  async handleLLMEnd(output: LLMResult): Promise<void> {
    const llmOut = output.llmOutput as Record<string, unknown> | undefined;
    if (!llmOut) return;

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

    // 记录节点级明细
    if (this._currentNode) {
      const durationMs = this._nodeStartMs != null
        ? Date.now() - this._nodeStartMs
        : null;
      this._nodeUsages.push({
        nodeName: this._currentNode,
        inputTokens: inp,
        outputTokens: out,
        totalTokens: inp + out,
        durationMs,
      });
    }
  }
}
