import { Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { AgentState, PlanDef } from '@/agent/agent.state';
import { AgentCallbacks } from '@/agent/agent.callbacks';
import { SkillRegistry } from '@/skill/skill.registry';
import { ToolRegistry } from '@/tool/tool.registry';
import { TASK_EVENTS } from '@/common/events/task.events';
import { EventPublisher } from '@/event/event.publisher';
import { plannerPrompt, INTENT_GUIDANCE } from '@/prompts';
import {
  PlanSemanticValidationOptions,
  validatePlanSemantics,
  formatValidationErrors,
} from '@/agent/plan-semantic-validator';
import { interrupt } from '@langchain/langgraph';
import { buildGuardedPlannerChain } from '@/agent/guardrails/guardrail.chain';
import { GuardrailBlockedError } from '@/agent/guardrails/guardrail-blocked.error';
import { RunStatus } from '@/common/enums';

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
  validationOptions: PlanSemanticValidationOptions = {},
): Promise<Partial<AgentState>> {
  const isReplan = state.replanCount > 0;
  // replan 时 router 被跳过，planner 自己发事件
  if (isReplan) {
    eventPublisher.emit(TASK_EVENTS.PLAN_GENERATING, {
      taskId: state.taskId,
      runId: state.runId,
      isReplan: true,
    });
  }

  const skillSection = skillRegistry.getPlannerPromptSection();

  const toolInputExamples = [
    '- web_search:      {"query": "搜索词"}\n' +
      '- browse_url:      {"url": "https://..."}\n' +
      '- fetch_url_as_markdown: {"url": "https://..."}\n' +
      '- read_file:       {"task_id": "<taskId>", "path": "文件名"}\n' +
      // write_file 只用于单文件场景，多文件代码项目应使用 code_project_generation skill
      '- write_file:      {"task_id": "<taskId>", "path": "文件名", "content": "完整文件内容（非占位符）"}\n' +
      '- list_directory:  {"task_id": "<taskId>", "path": "."}\n' +
      '- download_file:   {"task_id": "<taskId>", "url": "https://...", "path": "资料.pdf"}\n' +
      '- extract_pdf_text: {"task_id": "<taskId>", "path": "资料.pdf"}\n' +
      '- export_pdf:      {"task_id": "<taskId>", "title": "报告", "content": "...", "path": "report.pdf"}\n' +
      '- github_search:   {"query": "langgraph agent", "max_results": 5}\n' +
      '- think:           {"thought": "推理内容"}\n\n' +
      '⚠️ 选择执行器的关键原则：\n' +
      '  • 任务涉及"生成多个代码文件"或"脚手架项目" → 必须使用 code_project_generation skill，不可拆成多个 write_file step\n' +
      '  • write_file 只用于写单个配置文件、数据文件或 skill 内部辅助写入\n' +
      '  • 调研/报告/briefing/对比 → 优先使用对应 skill（web_research / report_packaging / competitive_analysis 等）',
  ];

  if (toolRegistry.has('browser_open')) {
    toolInputExamples.push(
      '- browser_open:   {"task_id": "<taskId>", "url": "https://...", "timeout_ms": 15000}\n' +
        '- browser_extract: {"session_id": "<browser_open 返回的 session_id>", "selector": "main", "max_length": 12000}\n' +
        '- browser_screenshot: {"task_id": "<taskId>", "session_id": "<browser_open 返回的 session_id>", "path": "browser-screenshots/page.png", "full_page": true}',
    );
  }

  const toolSection =
    '可直接使用的工具（无对应 skill 时使用，需填写 toolHint 和 toolInput）：\n' +
    toolRegistry
      .getAll()
      .map((t) => `- ${t.name} [${t.type}]: ${t.description}`)
      .join('\n') +
    '\n工具参数示例（toolInput 字段）：\n' +
    toolInputExamples.join('\n');

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

  // ─── Guardrail 包裹的 Planner chain ────────────────────────────────────────
  // 执行顺序：plannerLLM → outputGuardrail → semanticValidator
  const llmChain = plannerPrompt.pipe(
    llm.withStructuredOutput(PlanSchema, { method: soMethod }),
  );
  const chain = buildGuardedPlannerChain(llmChain);

  const intentGuidance = INTENT_GUIDANCE[state.taskIntent] ?? '';
  if (intentGuidance) {
    logger.log(`应用意图特化策略: ${state.taskIntent}`);
  }

  const baseInvokeArgs = {
    revisionInput: state.revisionInput,
    taskId: state.taskId,
    completedContext,
    skillSection,
    toolSection,
    memoryContext,
    intentGuidance,
  };

  // ─── 语义校验：最多尝试 2 次，第二次携带错误反馈 ─────────────────────────────
  let planSteps: z.infer<typeof PlanSchema>['steps'];

  let result1: z.infer<typeof PlanSchema>;
  try {
    result1 = (await chain.invoke({
      ...baseInvokeArgs,
      validationErrors: '',
    })) as z.infer<typeof PlanSchema>;
  } catch (err) {
    if (err instanceof GuardrailBlockedError) {
      logger.warn(`Guardrail blocked (attempt 1): ${err.message}`);
      return {
        shouldStop: true,
        errorMessage: `guardrail_blocked:${err.reason}`,
      };
    }
    throw err;
  }
  const errors1 = validatePlanSemantics(
    result1.steps,
    skillRegistry,
    toolRegistry,
    validationOptions,
  );

  if (errors1.length === 0) {
    planSteps = result1.steps;
  } else {
    logger.warn(
      `Plan semantic validation failed (attempt 1): ${errors1.map((e) => e.message).join(' | ')}`,
    );
    const validationErrors = formatValidationErrors(errors1);
    let result2: z.infer<typeof PlanSchema>;
    try {
      result2 = (await chain.invoke({
        ...baseInvokeArgs,
        validationErrors,
      })) as z.infer<typeof PlanSchema>;
    } catch (err) {
      if (err instanceof GuardrailBlockedError) {
        logger.warn(`Guardrail blocked (attempt 2): ${err.message}`);
        return {
          shouldStop: true,
          errorMessage: `guardrail_blocked:${err.reason}`,
        };
      }
      throw err;
    }
    const errors2 = validatePlanSemantics(
      result2.steps,
      skillRegistry,
      toolRegistry,
      validationOptions,
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

  // ─── plan_first HITL：计划生成后、执行前暂停等待用户审批 ──────────────────────
  if (state.approvalMode === 'plan_first') {
    const stepSummaries = planSteps.map((s) => ({
      stepIndex: s.stepIndex,
      description: s.description,
      executor: s.skillName ?? s.toolHint ?? 'think',
      isSideEffect:
        (s.skillName && skillRegistry.has(s.skillName)
          ? skillRegistry.get(s.skillName).effect === 'side-effect'
          : false) ||
        (s.toolHint && toolRegistry.has(s.toolHint)
          ? toolRegistry.get(s.toolHint).type === 'side-effect'
          : false),
    }));

    const planReviewInfo = {
      type: 'plan_review' as const,
      planId: plan.id,
      stepCount: planSteps.length,
      steps: stepSummaries,
    };
    await callbacks.setRunAwaitingApproval(state.runId, planReviewInfo);
    const decision = interrupt(planReviewInfo);
    await callbacks.setRunStatus(state.runId, RunStatus.RUNNING);
    if (decision === 'rejected') {
      return { shouldStop: true, errorMessage: 'plan_rejected' };
    }
  }

  return {
    currentPlan: planDef,
    currentStepIndex: 0,
    retryCount: 0,
    evaluation: null,
    lastStepRunId: '',
    lastStepOutput: '',
  };
}
