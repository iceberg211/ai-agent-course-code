import { Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { AgentState, TaskIntent } from '@/agent/agent.state';
import { EventPublisher } from '@/event/event.publisher';
import { TASK_EVENTS } from '@/common/events/task.events';

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
  reason: z.string(),
});

const routerPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个任务意图分类器。根据用户任务描述，判断属于以下哪种类型：

- code_generation: 生成代码项目、脚手架、写程序、创建应用
- research_report: 调研报告、技术方案、深度分析、信息收集
- competitive_analysis: 对比分析、竞品调研、方案比较
- content_writing: 撰写文档、文章、邮件、演讲稿、总结
- general: 以上都不匹配

只返回 JSON。`,
  ],
  ['human', `任务：{revisionInput}`],
]);

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
    logger.log(`意图分类: ${intent} | ${result.reason}`);

    eventPublisher.emit(TASK_EVENTS.PLAN_GENERATING, {
      taskId: state.taskId,
      runId: state.runId,
      isReplan: false,
      intent,
    });

    return { taskIntent: intent };
  } catch (err) {
    logger.warn(
      `意图分类失败: ${err instanceof Error ? err.message : err}，默认 general`,
    );
    return { taskIntent: 'general' };
  }
}
