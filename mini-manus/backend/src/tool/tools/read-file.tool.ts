import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import { z } from 'zod';
import { Tool, ToolResult, truncateOutput } from '@/tool/interfaces/tool.interface';
import { WorkspaceService } from '@/workspace/workspace.service';

const schema = z.object({
  task_id: z.string().uuid(),
  path: z.string().min(1).describe('Relative path inside workspace'),
});

@Injectable()
export class ReadFileTool implements Tool {
  readonly name = 'read_file';
  readonly description =
    'Read a file from the task workspace. Path is relative to the task directory.';
  readonly schema = schema;
  readonly type = 'read-only' as const;

  constructor(private readonly workspace: WorkspaceService) {}

  async execute(input: unknown): Promise<ToolResult> {
    const { task_id, path: filePath } = schema.parse(input);
    try {
      const safePath = this.workspace.resolveSafePath(task_id, filePath);
      const content = await fs.readFile(safePath, 'utf-8');
      return { success: true, output: truncateOutput(content) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `Cannot read file: ${msg}` };
    }
  }
}
