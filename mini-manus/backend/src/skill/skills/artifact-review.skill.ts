import { z } from 'zod';
import {
  Skill,
  SkillContext,
  SkillEvent,
} from '@/skill/interfaces/skill.interface';
import { artifactReviewPrompt } from '@/prompts';

const inputSchema = z
  .object({
    review_goal: z
      .string()
      .min(1)
      .default('检查完整性、风险和缺失项')
      .optional(),
    content: z.string().optional(),
    task_id: z.string().uuid().optional(),
    path: z.string().optional(),
  })
  .refine((value) => value.content || (value.task_id && value.path), {
    message: '必须提供 content，或提供 task_id + path',
  });

const outputSchema = z.object({
  review: z.string(),
});

export class ArtifactReviewSkill implements Skill {
  readonly name = 'artifact_review';
  readonly description = '审阅已有产物或文件，给出缺失项、风险点和修改建议。';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly effect = 'read-only' as const;

  async *execute(
    input: unknown,
    ctx: SkillContext,
  ): AsyncGenerator<SkillEvent> {
    const parsed = inputSchema.parse(input);

    let artifactContent = parsed.content?.trim() ?? '';
    if (!artifactContent && parsed.task_id && parsed.path) {
      yield {
        type: 'tool_call',
        tool: 'read_file',
        input: { task_id: parsed.task_id, path: parsed.path },
      };
      const readResult = await ctx.tools.executeWithCache('read_file', {
        task_id: parsed.task_id,
        path: parsed.path,
      });
      yield {
        type: 'tool_result',
        tool: 'read_file',
        output: readResult.output || readResult.error || '',
        cached: readResult.cached ?? false,
        error: readResult.error ?? null,
        errorCode: readResult.errorCode ?? null,
      };
      artifactContent = readResult.output;
    }

    if (ctx.signal.aborted) return;

    yield { type: 'progress', message: '正在审阅产物质量...' };
    const chain = artifactReviewPrompt.pipe(ctx.llm);
    const response = await chain.invoke({
      artifactContent: artifactContent || '暂无内容',
      reviewGoal: parsed.review_goal ?? '检查完整性、风险和缺失项',
    });

    const review =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    yield { type: 'reasoning', content: review };
    yield { type: 'result', output: { review } };
  }
}
