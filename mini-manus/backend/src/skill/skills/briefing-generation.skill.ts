import { z } from 'zod';
import {
  Skill,
  SkillContext,
  SkillEvent,
} from '@/skill/interfaces/skill.interface';
import { briefingGenerationPrompt } from '@/prompts';

const inputSchema = z.object({
  topic: z.string().min(1),
  audience: z.string().default('项目团队').optional(),
  goal: z.string().default('快速建立共识并明确下一步').optional(),
  context: z.string().optional(),
});

const outputSchema = z.object({
  briefing: z.string(),
});

export class BriefingGenerationSkill implements Skill {
  readonly name = 'briefing_generation';
  readonly description =
    '围绕一个主题生成会前 briefing，适合任务 kickoff、调研同步和方案评审准备。';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly effect = 'read-only' as const;

  async *execute(
    input: unknown,
    ctx: SkillContext,
  ): AsyncGenerator<SkillEvent> {
    const { topic, audience, goal, context } = inputSchema.parse(input);

    let sourceContext = context?.trim() ?? '';
    yield { type: 'progress', message: `正在准备 briefing：${topic}` };

    if (!sourceContext) {
      yield {
        type: 'tool_call',
        tool: 'web_search',
        input: { query: topic, max_results: 3 },
      };
      const searchResult = await ctx.tools.executeWithCache('web_search', {
        query: topic,
        max_results: 3,
      });
      yield {
        type: 'tool_result',
        tool: 'web_search',
        output: searchResult.output || searchResult.error || '',
        cached: searchResult.cached ?? false,
        error: searchResult.error ?? null,
        errorCode: searchResult.errorCode ?? null,
      };
      sourceContext = searchResult.output;
    }

    if (ctx.signal.aborted) return;

    const chain = briefingGenerationPrompt.pipe(ctx.llm);
    const response = await chain.invoke({
      topic,
      audience: audience ?? '项目团队',
      goal: goal ?? '快速建立共识并明确下一步',
      context: sourceContext || '暂无额外上下文',
    });

    const briefing =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    yield { type: 'reasoning', content: briefing };
    yield { type: 'result', output: { briefing } };
  }
}
