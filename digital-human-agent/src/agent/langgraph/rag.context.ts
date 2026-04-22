import { Annotation, type LangGraphRunnableConfig } from '@langchain/langgraph';
import { throwIfAborted } from '@/agent/agent.utils';
import type { RagWorkflowInput } from '@/agent/types/rag-workflow.types';

export const RagGraphContextAnnotation = Annotation.Root({
  workflowInput: Annotation<RagWorkflowInput>(),
});

export type RagGraphContext = typeof RagGraphContextAnnotation.State;

export type RagGraphConfig = LangGraphRunnableConfig<RagGraphContext>;

export function getWorkflowInput(config?: RagGraphConfig): RagWorkflowInput {
  const input =
    config?.context?.workflowInput ?? config?.configurable?.workflowInput;
  if (!input) {
    throw new Error('LangGraph 运行缺少 workflowInput');
  }
  return input;
}

export function ensureWorkflowNotAborted(
  config?: RagGraphConfig,
): RagWorkflowInput {
  const input = getWorkflowInput(config);
  throwIfAborted(input.signal);
  return input;
}
