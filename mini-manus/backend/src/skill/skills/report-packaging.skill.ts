import { z } from 'zod';
import {
  Skill,
  SkillContext,
  SkillEvent,
} from '@/skill/interfaces/skill.interface';
import { reportPackagingPrompt, reportMetadataPrompt } from '@/prompts';

const inputSchema = z.object({
  task_id: z.string().uuid(),
  title: z.string().min(1),
  source_material: z.string().min(1),
  output_basename: z.string().default('task-report').optional(),
  include_diagram: z.boolean().default(true).optional(),
  export_pdf: z.boolean().default(true).optional(),
});

// 元数据 schema（字段少、内容短，structured output 安全）
const metadataSchema = z.object({
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

    // ── 第一步：纯文本生成 Markdown（避免长文本塞 JSON 编码崩溃）──
    yield { type: 'progress', message: `正在撰写报告：${title}` };
    const markdownChain = reportPackagingPrompt.pipe(ctx.llm);
    const markdownResponse = await markdownChain.invoke({
      title,
      sourceMaterial: source_material,
    });
    const markdown =
      typeof markdownResponse.content === 'string'
        ? markdownResponse.content
        : Array.isArray(markdownResponse.content)
          ? markdownResponse.content
              .map((c) => (typeof c === 'string' ? c : JSON.stringify(c)))
              .join('')
          : JSON.stringify(markdownResponse.content);

    if (ctx.signal.aborted) return;

    // F7 fix: 先写 markdown 文件，确保即使后续 metadata 提取失败，报告正文已保存
    const mdPath = `${basename}.md`;
    yield {
      type: 'tool_call',
      tool: 'write_file',
      input: { task_id, path: mdPath, content: markdown },
    };
    const mdResult = await ctx.tools.executeWithCache('write_file', {
      task_id,
      path: mdPath,
      content: markdown,
    });
    yield {
      type: 'tool_result',
      tool: 'write_file',
      output: mdResult.output || mdResult.error || '',
      cached: mdResult.cached ?? false,
      error: mdResult.error ?? null,
      errorCode: mdResult.errorCode ?? null,
    };
    if (!mdResult.success) {
      throw new Error(mdResult.error ?? `主报告写入失败: ${mdPath}`);
    }
    const files: string[] = [mdPath];

    // ── 第二步：structured output 提取元数据（内容短，JSON 安全）──
    yield { type: 'progress', message: '正在提取报告摘要...' };
    const metadataChain = reportMetadataPrompt.pipe(
      ctx.llm.withStructuredOutput(metadataSchema, { method: ctx.soMethod }),
    );
    const metadata = await metadataChain.invoke({
      title,
      markdownPreview: markdown.slice(0, 2000),
    });

    if (ctx.signal.aborted) return;

    const manifest = {
      summary: metadata.summary,
      key_points: metadata.key_points,
      generated_at: new Date().toISOString(),
      artifact_type: 'markdown',
    };

    // markdown 已在第一步写入，这里只写 json 和可选 diagram
    const writes: Array<{ path: string; content: string }> = [
      { path: `${basename}.json`, content: JSON.stringify(manifest, null, 2) },
    ];

    if (include_diagram && metadata.diagram.trim()) {
      writes.push({
        path: `${basename}.mmd`,
        content: metadata.diagram.trim(),
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
          content: markdown,
          path: `${basename}.pdf`,
        },
      };
      const pdfResult = await ctx.tools.executeWithCache('export_pdf', {
        task_id,
        title,
        content: markdown,
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

    yield { type: 'reasoning', content: metadata.summary };
    yield {
      type: 'result',
      output: {
        files,
        summary: metadata.summary,
        key_points: metadata.key_points,
      },
    };
  }
}
