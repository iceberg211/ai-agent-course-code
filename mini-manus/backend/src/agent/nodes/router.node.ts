import { Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { AgentState, TaskIntent } from '@/agent/agent.state';
import { EventPublisher } from '@/event/event.publisher';
import { TASK_EVENTS } from '@/common/events/task.events';
import { routerPrompt } from '@/prompts';

const logger = new Logger('RouterNode');

const VALID_INTENTS: TaskIntent[] = [
  'code_generation',
  'research_report',
  'competitive_analysis',
  'content_writing',
  'general',
];

const IntentSchema = z.object({
  intent: z.enum(VALID_INTENTS as [TaskIntent, ...TaskIntent[]]),
  subType: z
    .string()
    .describe(
      '更细化的子类型。' +
        'code_generation 填: web_app / cli_tool / data_script / api_server / other；' +
        'research_report 填: technical_analysis / market_research / tutorial / other；' +
        '其他意图填 other',
    ),
  reason: z.string(),
});

/**
 * Intent Router：轻量级意图分类（1 次快速 LLM 调用）。
 * 在 Planner 之前执行，结果写入 state.taskIntent，
 * Planner 根据意图选择领域特化的规划策略。
 */
export async function routerNode(
  state: AgentState,
  llm: ChatOpenAI,
  eventPublisher: EventPublisher,
  soMethod: 'functionCalling' | 'json_schema' | 'jsonMode' = 'functionCalling',
): Promise<Partial<AgentState>> {
  // replan 时跳过 router，复用首次分类结果
  if (state.replanCount > 0 && state.taskIntent !== 'general') {
    logger.log(`replan 复用意图: ${state.taskIntent}`);
    return {};
  }

  try {
    const chain = routerPrompt.pipe(
      llm.withStructuredOutput(IntentSchema, { method: soMethod }),
    );
    const result = await chain.invoke({
      revisionInput: state.revisionInput,
    });

    const intent = result.intent as TaskIntent;
    const subType = result.subType ?? 'other';
    logger.log(`意图分类: ${intent}/${subType} | ${result.reason}`);

    eventPublisher.emit(TASK_EVENTS.PLAN_GENERATING, {
      taskId: state.taskId,
      runId: state.runId,
      isReplan: false,
      intent,
    });

    return { taskIntent: intent, taskIntentSubType: subType };
  } catch (err) {
    logger.warn(
      `意图分类失败: ${err instanceof Error ? err.message : err}，默认 general`,
    );
    return { taskIntent: 'general' };
  }
}
