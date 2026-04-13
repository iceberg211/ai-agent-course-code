import { RunnableLambda, type Runnable } from '@langchain/core/runnables';
import { RunnableSequence } from '@langchain/core/runnables';
import { detectInjection } from '@/common/utils/prompt-safety';
import { GuardrailBlockedError } from '@/agent/guardrails/guardrail-blocked.error';

/**
 * 输出 Guardrail：扫描 Planner LLM 生成的 plan steps 是否含注入内容。
 *
 * 用户输入已在 HTTP 层（task.service.ts）完成注入检测，这里只保护 LLM 输出。
 * LLM 有可能因 prompt context（网页内容、历史记忆）被诱导，在 plan 中写出
 * 看起来像指令的 description，此处将其拦截。
 */
export const outputGuardrail = RunnableLambda.from(
  (plan: { steps: Array<{ description?: string }> }) => {
    for (const step of plan.steps ?? []) {
      const risk = detectInjection(step.description ?? '');
      if (risk) {
        throw new GuardrailBlockedError('plan_injection', risk);
      }
    }
    return plan;
  },
).withConfig({ runName: 'OutputGuardrail' });

/**
 * 用 outputGuardrail 包裹 Planner LLM chain。
 *
 * 执行顺序：plannerLLM → outputGuardrail → semanticValidator
 *
 * 注：inputGuardrail 已移除，输入校验由 HTTP 层负责（task.service.ts），
 * 不在 LLM 调用链内重复处理同一份数据。
 */
export function buildGuardedPlannerChain(plannerLlmChain: Runnable): Runnable {
  return RunnableSequence.from([plannerLlmChain, outputGuardrail]);
}
