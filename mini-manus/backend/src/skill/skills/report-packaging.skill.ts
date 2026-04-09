import { z } from 'zod';
import {
  Skill,
  SkillContext,
  SkillEvent,
} from '@/skill/interfaces/skill.interface';
import { reportPackagingPrompt } from '@/prompts';

const inputSchema = z.object({
  task_id: z.string().uuid(),
  title: z.string().min(1),
  source_material: z.string().min(1),
  output_basename: z.string().default('task-report').optional(),
  include_diagram: z.boolean().default(true).optional(),
  export_pdf: z.boolean().default(true).optional(),
});

const packagingSchema = z.object({
  markdown: z.string().min(1),
  summary: z.string().min(1),
  key_points: z.array(z.string()).min(1),
  diagram: z.string(),
});

const outputSchema = z.object({
  files: z.array(z.string()),
  summary: z.string(),
  key_points: z.array(z.string()),
});

export class ReportPackagingSkill implements Skill {
  readonly name = 'report_packaging';
  readonly description =
    '把已有材料打包成主报告、JSON 摘要、可选图表和 PDF 文件，适合交付收口阶段。';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly effect = 'side-effect' as const;

  async *execute(
    input: unknown,
    ctx: SkillContext,
  ): AsyncGenerator<SkillEvent> {
    const {
      task_id,
      title,
      source_material,
      output_basename,
      include_diagram,
      export_pdf,
    } = inputSchema.parse(input);
    const basename = output_basename ?? 'task-report';

    yield { type: 'progress', message: `正在打包交付物：${title}` };
    const chain = reportPackagingPrompt.pipe(
      ctx.llm.withStructuredOutput(packagingSchema, { method: ctx.soMethod }),
    );
    const packaged = await chain.invoke({
      title,
      sourceMaterial: source_material,
    });

    if (ctx.signal.aborted) return;

    const manifest = {
      summary: packaged.summary,
      key_points: packaged.key_points,
      generated_at: new Date().toISOString(),
      artifact_type: 'markdown',
    };

    const files: string[] = [];

    const writes: Array<{ path: string; content: string }> = [
      { path: `${basename}.md`, content: packaged.markdown },
      { path: `${basename}.json`, content: JSON.stringify(manifest, null, 2) },
    ];

    if (include_diagram && packaged.diagram.trim()) {
      writes.push({
        path: `${basename}.mmd`,
        content: packaged.diagram.trim(),
      });
    }

    for (const item of writes) {
      yield {
        type: 'tool_call',
        tool: 'write_file',
        input: { task_id, path: item.path, content: item.content },
      };
      const writeResult = await ctx.tools.executeWithCache('write_file', {
        task_id,
        path: item.path,
        content: item.content,
      });
      yield {
        type: 'tool_result',
        tool: 'write_file',
        output: writeResult.output || writeResult.error || '',
        cached: writeResult.cached ?? false,
        error: writeResult.error ?? null,
        errorCode: writeResult.errorCode ?? null,
      };
      if (!writeResult.success) {
        throw new Error(writeResult.error ?? `写入 ${item.path} 失败`);
      }
      files.push(item.path);
    }

    if (export_pdf) {
      yield {
        type: 'tool_call',
        tool: 'export_pdf',
        input: {
          task_id,
          title,
          content: packaged.markdown,
          path: `${basename}.pdf`,
        },
      };
      const pdfResult = await ctx.tools.executeWithCache('export_pdf', {
        task_id,
        title,
        content: packaged.markdown,
        path: `${basename}.pdf`,
      });
      yield {
        type: 'tool_result',
        tool: 'export_pdf',
        output: pdfResult.output || pdfResult.error || '',
        cached: pdfResult.cached ?? false,
        error: pdfResult.error ?? null,
        errorCode: pdfResult.errorCode ?? null,
      };
      if (pdfResult.success) {
        files.push(`${basename}.pdf`);
      }
    }

    yield { type: 'reasoning', content: packaged.summary };
    yield {
      type: 'result',
      output: {
        files,
        summary: packaged.summary,
        key_points: packaged.key_points,
      },
    };
  }
}
