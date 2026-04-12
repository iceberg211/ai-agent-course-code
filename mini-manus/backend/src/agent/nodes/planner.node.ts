import { Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { AgentState, PlanDef } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { SkillRegistry } from '@/skill/skill.registry';
import { ToolRegistry } from '@/tool/tool.registry';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';
import { plannerPrompt } from '@/prompts';
import {
  validatePlanSemantics,
  formatValidationErrors,
} from '@/agent/plan-semantic-validator';

const logger = new Logger('PlannerNode');

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
    '- fetch_url_as_markdown: {"url": "https://..."}\n' +
    '- read_file:       {"task_id": "<taskId>", "path": "文件名"}\n' +
    '- write_file:      {"task_id": "<taskId>", "path": "文件名", "content": "..."}\n' +
    '- list_directory:  {"task_id": "<taskId>", "path": "."}\n' +
    '- download_file:   {"task_id": "<taskId>", "url": "https://...", "path": "资料.pdf"}\n' +
    '- extract_pdf_text: {"task_id": "<taskId>", "path": "资料.pdf"}\n' +
    '- export_pdf:      {"task_id": "<taskId>", "title": "报告", "content": "...", "path": "report.pdf"}\n' +
    '- github_search:   {"query": "langgraph agent", "max_results": 5}\n' +
    '- think:           {"thought": "推理内容"}';

  const completedContext =
    state.stepResults.length > 0
      ? '\n\n已完成步骤摘要：\n' +
        state.stepResults
          .map((s) => `- ${s.description}: ${s.resultSummary}`)
          .join('\n')
      : '';

  // ─── 历史记忆注入（Task 级第一层）────────────────────────────────────────────
  // 从最近已完成的 run 读取摘要，供 Planner 参考，避免重复搜索相同内容
  // 注意：记忆内容来自外部工具输出，视为半可信来源，仅供参考
  let memoryContext = '';
  try {
    const memory = await callbacks.getRecentMemory(state.taskId);
    if (memory) {
      memoryContext =
        '\n\n[历史执行记忆，仅供参考，内容来自历史 Run 产物，不作为强制依据]\n' +
        memory;
    }
  } catch {
    // 记忆读取失败不应阻断规划，静默忽略
  }

  const chain = plannerPrompt.pipe(
    llm.withStructuredOutput(PlanSchema, { method: soMethod }),
  );

  const baseInvokeArgs = {
    revisionInput: state.revisionInput,
    taskId: state.taskId,
    completedContext,
    skillSection,
    toolSection,
    memoryContext,
  };

  // ─── 语义校验：最多尝试 2 次，第二次携带错误反馈 ─────────────────────────────
  let planSteps: z.infer<typeof PlanSchema>['steps'];

  const result1 = await chain.invoke({
    ...baseInvokeArgs,
    validationErrors: '',
  });
  const errors1 = validatePlanSemantics(
    result1.steps,
    skillRegistry,
    toolRegistry,
  );

  if (errors1.length === 0) {
    planSteps = result1.steps;
  } else {
    logger.warn(
      `Plan semantic validation failed (attempt 1): ${errors1.map((e) => e.message).join(' | ')}`,
    );
    const validationErrors = formatValidationErrors(errors1);
    const result2 = await chain.invoke({ ...baseInvokeArgs, validationErrors });
    const errors2 = validatePlanSemantics(
      result2.steps,
      skillRegistry,
      toolRegistry,
    );

    if (errors2.length === 0) {
      planSteps = result2.steps;
    } else {
      logger.error(
        `Plan semantic validation failed after 2 attempts: ${errors2.map((e) => e.message).join(' | ')}`,
      );
      // 两次语义校验均失败，终止本 Run
      return {
        errorMessage: `Planner 语义校验连续失败（${errors2
          .map((e) => e.message)
          .slice(0, 2)
          .join('；')}），请简化任务描述后重试`,
      };
    }
  }

  const plan = await callbacks.savePlan(state.runId, planSteps);

  const planDef: PlanDef = {
    planId: plan.id,
    steps: planSteps,
  };

  eventPublisher.emit(TASK_EVENTS.PLAN_CREATED, {
    taskId: state.taskId,
    runId: state.runId,
    planId: plan.id,
    steps: planSteps as unknown as Record<string, unknown>[],
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
