import { z } from 'zod';
import {
  Skill,
  SkillContext,
  SkillEvent,
} from '@/skill/interfaces/skill.interface';
import { codeFixPrompt } from '@/prompts';

const inputSchema = z.object({
  task_id: z.string().uuid(),
  error_output: z.string().describe('沙箱运行的错误输出（stderr + exitCode）'),
  project_dir: z.string().default('project'),
});

const outputSchema = z.object({
  fixedFiles: z.array(z.string()),
  file_count: z.number(),
});

/** 需要优先读取的关键文件，代码修复时最可能需要它们 */
const KEY_FILES = [
  'package.json',
  'index.js',
  'index.ts',
  'src/index.js',
  'src/index.ts',
  'main.js',
  'main.ts',
];

export class CodeFixSkill implements Skill {
  readonly name = 'code_fix';
  readonly description =
    '根据沙箱运行错误修复代码文件，用于代码执行失败后的 replan 步骤。不重新生成整个项目，只修复有问题的文件。';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly effect = 'side-effect' as const;

  async *execute(
    input: unknown,
    ctx: SkillContext,
  ): AsyncGenerator<SkillEvent> {
    const { task_id, error_output, project_dir } = inputSchema.parse(input);
    const rootDir = project_dir;

    yield { type: 'progress', message: '正在读取项目结构…' };

    // 1. 读取文件列表
    yield {
      type: 'tool_call',
      tool: 'list_directory',
      input: { task_id, path: rootDir },
    };
    const listResult = await ctx.tools.executeWithCache('list_directory', {
      task_id,
      path: rootDir,
    });
    yield {
      type: 'tool_result',
      tool: 'list_directory',
      output: listResult.output,
      cached: listResult.cached ?? false,
      error: listResult.error ?? null,
      errorCode: listResult.errorCode ?? null,
    };

    if (ctx.signal.aborted) return;

    // 2. 读取关键文件（最多 3 个），给 LLM 足够的上下文
    const fileContents: string[] = [];
    let readCount = 0;
    for (const f of KEY_FILES) {
      if (ctx.signal.aborted || readCount >= 3) break;
      const filePath = `${rootDir}/${f}`;
      yield {
        type: 'tool_call',
        tool: 'read_file',
        input: { task_id, path: filePath },
      };
      const readResult = await ctx.tools.executeWithCache('read_file', {
        task_id,
        path: filePath,
      });
      yield {
        type: 'tool_result',
        tool: 'read_file',
        output: (readResult.output || readResult.error || '').slice(0, 300),
        cached: readResult.cached ?? false,
        error: readResult.error ?? null,
        errorCode: readResult.errorCode ?? null,
      };
      if (readResult.success) {
        fileContents.push(`--- ${filePath} ---\n${readResult.output}`);
        readCount++;
      }
    }

    if (ctx.signal.aborted) return;

    // 3. LLM 分析错误并生成修复 patch
    yield { type: 'progress', message: '正在分析错误并生成修复方案…' };
    const chain = codeFixPrompt.pipe(ctx.llm);
    const response = await chain.invoke({
      errorOutput: error_output.slice(0, 2000),
      fileList: listResult.output.slice(0, 500),
      fileContents: fileContents.join('\n\n').slice(0, 4000),
    });

    if (ctx.signal.aborted) return;

    const rawContent =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    yield { type: 'reasoning', content: rawContent };

    // 4. 解析并写入修复后的文件
    const FILE_SEPARATOR = '---FILE:';
    const parts = rawContent.split(new RegExp(`^${FILE_SEPARATOR}\\s*`, 'm'));
    const fixedFiles: string[] = [];

    for (const part of parts) {
      if (!part.trim() || ctx.signal.aborted) continue;
      const nl = part.indexOf('\n');
      if (nl === -1) continue;
      const relPath = part.slice(0, nl).trim().replace(/['"]/g, '');
      if (!relPath) continue;
      // 如果 LLM 已经写了 rootDir 前缀则直接用，否则拼接
      const filePath = relPath.startsWith(`${rootDir}/`)
        ? relPath
        : `${rootDir}/${relPath}`;
      const content = part
        .slice(nl + 1)
        .replace(/^```[\w-]*\n/i, '')
        .replace(/\n```\s*$/i, '')
        .trimEnd();
      if (!content) continue;

      yield {
        type: 'tool_call',
        tool: 'write_file',
        input: { task_id, path: filePath, content },
      };
      const writeResult = await ctx.tools.executeWithCache('write_file', {
        task_id,
        path: filePath,
        content,
      });
      yield {
        type: 'tool_result',
        tool: 'write_file',
        output: writeResult.output,
        cached: writeResult.cached ?? false,
        error: writeResult.error ?? null,
        errorCode: writeResult.errorCode ?? null,
      };
      if (!writeResult.success) {
        throw new Error(writeResult.error ?? `写入 ${filePath} 失败`);
      }
      fixedFiles.push(filePath);
    }

    yield {
      type: 'result',
      output: { fixedFiles, file_count: fixedFiles.length },
    };
  }
}
