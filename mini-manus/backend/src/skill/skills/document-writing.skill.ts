import { z } from 'zod';
import {
  Skill,
  SkillContext,
  SkillEvent,
} from '@/skill/interfaces/skill.interface';
import { documentWritingPrompt } from '@/prompts';

const inputSchema = z.object({
  task_id: z.string().uuid(),
  title: z.string().min(1),
  brief: z
    .string()
    .min(1)
    .describe('Content brief or source material to write from'),
  filename: z.string().min(1).default('output.md').optional(),
});

const outputSchema = z.object({
  file_path: z.string(),
  word_count: z.number(),
});

export class DocumentWritingSkill implements Skill {
  readonly name = 'document_writing';
  readonly description =
    'Write a structured Markdown document based on a title and brief, then save it to the workspace. Idempotent: overwrites if file exists.';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly effect = 'side-effect' as const;

  async *execute(
    input: unknown,
    ctx: SkillContext,
  ): AsyncGenerator<SkillEvent> {
    const { task_id, title, brief, filename } = inputSchema.parse(input);
    const targetFile = filename ?? 'output.md';

    if (ctx.signal.aborted) return;

    yield { type: 'progress', message: `正在撰写文档: ${title}` };

    // Generate document content
    const chain = documentWritingPrompt.pipe(ctx.llm);
    const response = await chain.invoke({ title, brief });

    if (ctx.signal.aborted) return;

    const rawContent = response.content;
    const content =
      typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent
              .map((c) => (typeof c === 'string' ? c : JSON.stringify(c)))
              .join('')
          : JSON.stringify(rawContent);
    yield {
      type: 'reasoning',
      content: `文档已生成，共 ${content.length} 字符`,
    };

    // Write to workspace (idempotent - overwrites)
    const writeTool = ctx.tools.get('write_file');
    yield {
      type: 'tool_call',
      tool: 'write_file',
      input: { task_id, path: targetFile, content },
    };
    const writeResult = await writeTool.execute({
      task_id,
      path: targetFile,
      content,
    });
    yield {
      type: 'tool_result',
      tool: 'write_file',
      output: writeResult.output,
    };

    if (!writeResult.success) {
      throw new Error(`Failed to write document: ${writeResult.error}`);
    }

    yield {
      type: 'result',
      output: { file_path: targetFile, word_count: content.length },
    };
  }
}
