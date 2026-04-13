import { z } from 'zod';
import {
  Skill,
  SkillContext,
  SkillEvent,
} from '@/skill/interfaces/skill.interface';
import { ChatPromptTemplate } from '@langchain/core/prompts';

const inputSchema = z.object({
  task_id: z.string().uuid(),
  project_description: z
    .string()
    .min(1)
    .describe('项目需求描述，如 "用 Vite + React + TypeScript 创建 Todo 应用"'),
  output_dir: z
    .string()
    .default('project')
    .optional()
    .describe('项目文件输出的根目录'),
});

const fileListSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1).describe('相对于 output_dir 的文件路径'),
      description: z.string().describe('文件功能简述'),
    }),
  ),
});

const outputSchema = z.object({
  files: z.array(z.string()),
  file_count: z.number(),
});

// 第一步：生成文件清单（structured output，内容短，安全）
const fileListPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个项目脚手架助手。根据项目需求，规划需要生成的文件清单。

要求：
- 只列出真正需要的文件，不要过度设计
- 包含配置文件（package.json, tsconfig.json 等）
- 包含入口文件和核心代码
- 路径使用正斜杠，相对于项目根目录
- 只返回 JSON`,
  ],
  [
    'human',
    `项目需求：{projectDescription}

请返回文件清单 JSON（files 数组，每项含 path 和 description）：`,
  ],
]);

// 第二步：逐个文件生成内容（纯文本输出，避免长代码塞 JSON）
const fileContentPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个代码生成助手。根据项目需求和文件描述，生成完整的文件内容。

要求：
- 生成完整可运行的代码，不要省略
- 直接输出文件内容，不要包裹在代码块中
- 不要输出文件名或注释前缀`,
  ],
  [
    'human',
    `项目需求：{projectDescription}

当前文件：{filePath}
文件功能：{fileDescription}

已生成的其他文件路径：
{existingFiles}

请直接输出该文件的完整内容：`,
  ],
]);

export class CodeProjectGenerationSkill implements Skill {
  readonly name = 'code_project_generation';
  readonly description =
    '根据项目需求生成完整的多文件代码项目（如 React/Vue/Node.js 等），一个 Plan step 内部完成所有文件的创建。';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly effect = 'side-effect' as const;

  async *execute(
    input: unknown,
    ctx: SkillContext,
  ): AsyncGenerator<SkillEvent> {
    const { task_id, project_description, output_dir } =
      inputSchema.parse(input);
    const rootDir = output_dir ?? 'project';

    // ── 第一步：规划文件清单 ──
    yield {
      type: 'progress',
      message: `正在规划项目文件结构…`,
    };

    const fileListChain = fileListPrompt.pipe(
      ctx.llm.withStructuredOutput(fileListSchema, { method: ctx.soMethod }),
    );
    const { files: fileList } = await fileListChain.invoke({
      projectDescription: project_description,
    });

    if (ctx.signal.aborted) return;

    yield {
      type: 'progress',
      message: `已规划 ${fileList.length} 个文件，开始逐个生成…`,
    };

    // ── 第二步：逐个文件生成内容并写入 ──
    const writtenFiles: string[] = [];

    for (let i = 0; i < fileList.length; i++) {
      if (ctx.signal.aborted) break;

      const file = fileList[i];
      const filePath = `${rootDir}/${file.path}`;

      yield {
        type: 'progress',
        message: `正在生成 (${i + 1}/${fileList.length}): ${file.path}`,
      };

      // 纯文本生成文件内容（不走 structured output，避免长代码 JSON 编码崩溃）
      const contentChain = fileContentPrompt.pipe(ctx.llm);
      const response = await contentChain.invoke({
        projectDescription: project_description,
        filePath: file.path,
        fileDescription: file.description,
        existingFiles:
          writtenFiles.length > 0
            ? writtenFiles.join('\n')
            : '（这是第一个文件）',
      });

      const content =
        typeof response.content === 'string'
          ? response.content
          : Array.isArray(response.content)
            ? response.content
                .map((c) => (typeof c === 'string' ? c : JSON.stringify(c)))
                .join('')
            : JSON.stringify(response.content);

      // 清理 LLM 可能附带的代码块包裹
      const cleaned = content
        .replace(
          /^```(?:typescript|javascript|json|html|css|tsx|jsx|yaml|toml)?\n/i,
          '',
        )
        .replace(/\n```\s*$/i, '')
        .trim();

      if (ctx.signal.aborted) break;

      // 写入文件
      yield {
        type: 'tool_call',
        tool: 'write_file',
        input: { task_id, path: filePath, content: cleaned },
      };
      const writeResult = await ctx.tools.executeWithCache('write_file', {
        task_id,
        path: filePath,
        content: cleaned,
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
        throw new Error(writeResult.error ?? `写入 ${filePath} 失败`);
      }

      writtenFiles.push(file.path);
    }

    yield {
      type: 'result',
      output: {
        files: writtenFiles,
        file_count: writtenFiles.length,
      },
    };
  }
}
