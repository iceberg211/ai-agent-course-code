import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { AgentState, PlanDef } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { SkillRegistry } from '@/skill/skill.registry';
import { ToolRegistry } from '@/tool/tool.registry';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';
import { plannerPrompt } from '@/prompts';

const PlanSchema = z.object({
  steps: z.array(
    z.object({
      stepIndex: z.number().int().min(0),
      description: z.string().min(1),
      skillName: z.string().nullable().optional(),
      // z.any() → JSON schema 生成 {} ，避免 z.record() 产生的 patternProperties
      // Qwen 不支持 json_schema 格式里的 patternProperties
      skillInput: z.any().optional(),
      toolHint: z.string().nullable().optional(),
      toolInput: z.any().optional(),
    }),
  ),
});

export async function plannerNode(
  state: AgentState,
  llm: ChatOpenAI,
  skillRegistry: SkillRegistry,
  toolRegistry: ToolRegistry,
  callbacks: AgentCallbacks,
  eventPublisher: EventPublisher,
  soMethod: 'functionCalling' | 'json_schema' | 'jsonMode' = 'functionCalling',
): Promise<Partial<AgentState>> {
  const skillSection = skillRegistry.getPlannerPromptSection();

  const toolSection =
    '可直接使用的工具（无对应 skill 时使用，需填写 toolHint 和 toolInput）：\n' +
    toolRegistry
      .getAll()
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n') +
    '\n工具参数示例（toolInput 字段）：\n' +
    '- web_search:      {"query": "搜索词"}\n' +
    '- browse_url:      {"url": "https://..."}\n' +
    '- read_file:       {"task_id": "<taskId>", "path": "文件名"}\n' +
    '- write_file:      {"task_id": "<taskId>", "path": "文件名", "content": "..."}\n' +
    '- list_directory:  {"task_id": "<taskId>", "path": "."}\n' +
    '- think:           {"thought": "推理内容"}';

  const completedContext =
    state.stepResults.length > 0
      ? '\n\n已完成步骤摘要：\n' +
        state.stepResults
          .map((s) => `- ${s.description}: ${s.resultSummary}`)
          .join('\n')
      : '';

  const chain = plannerPrompt.pipe(
    llm.withStructuredOutput(PlanSchema, { method: soMethod }),
  );
  const result = await chain.invoke({
    revisionInput: state.revisionInput,
    taskId: state.taskId,
    completedContext,
    skillSection,
    toolSection,
  });

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
    lastStepRunId: '',
    lastStepOutput: '',
  };
}
