import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { Tool, ToolResult } from '@/tool/interfaces/tool.interface';
import { classifyToolError } from '@/tool/utils/tool-error';
import { WorkspaceService } from '@/workspace/workspace.service';

/** 明显占位符模式 — 不可交付内容，直接拒绝写入 */
const PLACEHOLDER_RE = /^(\.\.\.|TODO|PLACEHOLDER|<[^>]+>|\s*)$/i;

const schema = z.object({
  task_id: z.string().uuid(),
  path: z.string().min(1).describe('Relative path inside workspace'),
  content: z
    .string()
    .min(1, '写入内容不能为空')
    .refine(
      (v) => !PLACEHOLDER_RE.test(v.trim()),
      '写入内容不能为占位符（"..."、"TODO" 等）',
    )
    .describe('File content to write (overwrites existing)'),
});

@Injectable()
export class WriteFileTool implements Tool {
  readonly name = 'write_file';
  readonly description =
    'Write content to a file in the task workspace. Overwrites if exists.';
  readonly schema = schema;
  readonly type = 'side-effect' as const;

  constructor(private readonly workspace: WorkspaceService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const { task_id, path: filePath, content } = schema.parse(input);
      const safePath = this.workspace.resolveSafePath(task_id, filePath);
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, content, 'utf-8');
      return {
        success: true,
        output: `File written: ${filePath} (${content.length} chars)`,
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'Cannot write file');
    }
  }
}
