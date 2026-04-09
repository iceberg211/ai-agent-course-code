import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import { z } from 'zod';
import { Tool, ToolResult } from '@/tool/interfaces/tool.interface';
import { classifyToolError } from '@/tool/utils/tool-error';
import { WorkspaceService } from '@/workspace/workspace.service';

const schema = z.object({
  task_id: z.string().uuid(),
  path: z
    .string()
    .default('.')
    .describe('Relative directory path inside workspace'),
});

@Injectable()
export class ListDirectoryTool implements Tool {
  readonly name = 'list_directory';
  readonly description = 'List files and directories in the task workspace.';
  readonly schema = schema;
  readonly type = 'read-only' as const;

  constructor(private readonly workspace: WorkspaceService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const { task_id, path: dirPath } = schema.parse(input);
      const safePath = this.workspace.resolveSafePath(task_id, dirPath);
      const entries = await fs.readdir(safePath, { withFileTypes: true });
      const lines = entries.map((e) =>
        e.isDirectory() ? `[DIR]  ${e.name}/` : `[FILE] ${e.name}`,
      );
      return { success: true, output: lines.join('\n') || '(empty directory)' };
    } catch (err: unknown) {
      return classifyToolError(err, 'Cannot list directory');
    }
  }
}
