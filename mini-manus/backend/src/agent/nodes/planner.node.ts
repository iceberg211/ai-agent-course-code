import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { AgentState, PlanDef } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { SkillRegistry } from '@/skill/skill.registry';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';

const PlanSchema = z.object({
  steps: z.array(
    z.object({
      stepIndex: z.number().int().min(0),
      description: z.string().min(1),
      skillName: z.string().nullable().optional(),
      skillInput: z.record(z.string(), z.unknown()).nullable().optional(),
      toolHint: z.string().nullable().optional(),
    }),
  ),
});

export async function plannerNode(
  state: AgentState,
  llm: ChatOpenAI,
  skillRegistry: SkillRegistry,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
): Promise<Partial<AgentState>> {
  const skillSection = skillRegistry.getPlannerPromptSection();

  const completedContext =
    state.stepResults.length > 0
      ? '\n\n已完成步骤摘要：\n' +
        state.stepResults
          .map((s) => `- ${s.description}: ${s.resultSummary}`)
          .join('\n')
      : '';

  const prompt = `你是一个任务规划器。将用户任务拆解成 3-6 个可执行步骤。

任务：${state.revisionInput}${completedContext}

${skillSection}

规划要求：
1. 如果某一步能被已加载的 skill 覆盖，优先使用 skill（填写 skillName 和 skillInput）
2. 如果没有合适的 skill，填写 toolHint（工具名）并留空 skillName
3. 步骤数量 3-6 个，每步描述清晰
4. 回答只包含 JSON，不要其他内容`;

  const structured = llm.withStructuredOutput(PlanSchema);
  const result = await structured.invoke(prompt);

  const plan = await callbacks.savePlan(state.runId, result.steps);

  const planDef: PlanDef = {
    planId: plan.id,
    steps: result.steps,
  };

  eventPublisher.emit(TASK_EVENTS.PLAN_CREATED, {
    taskId: state.taskId,
    runId: state.runId,
    planId: plan.id,
    steps: result.steps as unknown as Record<string, unknown>[],
  });

  return {
    currentPlan: planDef,
    currentStepIndex: 0,
    retryCount: 0,
    evaluation: null,
  };
}
