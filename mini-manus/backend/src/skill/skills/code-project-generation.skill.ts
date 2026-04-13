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

const outputSchema = z.object({
  files: z.array(z.string()),
  file_count: z.number(),
});

// ─── 单 Artifact 模式 ─────────────────────────────────────────────────────────
// 业界最佳实践（bolt.new / Claude Artifacts）：一次 LLM 调用生成所有文件，
// 用分隔标记拆分，保证文件间上下文一致性，成本降为逐文件方案的 1/N。

const FILE_SEPARATOR = '---FILE:';

const projectPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个全栈项目生成助手。一次性生成项目所有文件的完整内容。

输出格式要求：
- 每个文件用 "${FILE_SEPARATOR} 相对路径" 作为开头标记（独占一行）
- 标记行后紧接文件的完整内容
- 文件内容不要包裹在代码块中
- 按依赖顺序排列（配置文件在前，业务代码在后）
- 最多 10 个核心文件，不要过度设计

示例格式：
${FILE_SEPARATOR} package.json
{
  "name": "my-app",
  "scripts": { "dev": "vite" }
}
${FILE_SEPARATOR} src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)

要求：
- 生成完整可运行的代码，不要省略
- 文件间的 import/require 路径必须一致
- 配置文件（package.json, tsconfig 等）的依赖版本使用当前主流稳定版`,
  ],
  [
    'human',
    `项目需求：{projectDescription}

请按上述格式一次性输出所有文件：`,
  ],
]);

/** 解析 LLM 输出中的 ---FILE: path--- 分隔块 */
function parseFileBlocks(
  raw: string,
): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  // 按 ---FILE: 分割
  const parts = raw.split(new RegExp(`^${FILE_SEPARATOR}\\s*`, 'm'));

  for (const part of parts) {
    if (!part.trim()) continue;

    const newlineIdx = part.indexOf('\n');
    if (newlineIdx === -1) continue;

    const pathLine = part.slice(0, newlineIdx).trim();
    // 清理路径：去掉可能的 --- 后缀和引号
    const path = pathLine.replace(/\s*-+\s*$/, '').replace(/['"]/g, '').trim();
    if (!path) continue;

    let content = part.slice(newlineIdx + 1);
    // 清理 LLM 可能附带的代码块包裹
    content = content
      .replace(
        /^```(?:typescript|javascript|json|html|css|tsx|jsx|yaml|toml|sh)?\n/i,
        '',
      )
      .replace(/\n```\s*$/i, '')
      .trimEnd();

    if (content) {
      files.push({ path, content });
    }
  }

  return files;
}

export class CodeProjectGenerationSkill implements Skill {
  readonly name = 'code_project_generation';
  readonly description =
    '根据项目需求一次性生成完整的多文件代码项目（React/Vue/Node.js 等），单个 Plan step 内完成。';
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

    // ── 一次 LLM 调用生成所有文件（单 Artifact 模式）──
    yield {
      type: 'progress',
      message: '正在生成项目代码（单次生成所有文件）…',
    };

    const chain = projectPrompt.pipe(ctx.llm);
    const response = await chain.invoke({
      projectDescription: project_description,
    });

    const rawContent =
      typeof response.content === 'string'
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((c) => (typeof c === 'string' ? c : JSON.stringify(c)))
              .join('')
          : JSON.stringify(response.content);

    if (ctx.signal.aborted) return;

    // ── 解析文件块 ──
    const files = parseFileBlocks(rawContent);

    if (files.length === 0) {
      throw new Error(
        '代码生成失败：LLM 输出中未找到有效的文件块（需要 ---FILE: path 分隔标记）',
      );
    }

    yield {
      type: 'progress',
      message: `已生成 ${files.length} 个文件，正在写入…`,
    };

    // ── 批量写入 ──
    const writtenFiles: string[] = [];

    for (const file of files) {
      if (ctx.signal.aborted) break;

      const filePath = `${rootDir}/${file.path}`;

      yield {
        type: 'tool_call',
        tool: 'write_file',
        input: { task_id, path: filePath, content: file.content },
      };
      const writeResult = await ctx.tools.executeWithCache('write_file', {
        task_id,
        path: filePath,
        content: file.content,
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
