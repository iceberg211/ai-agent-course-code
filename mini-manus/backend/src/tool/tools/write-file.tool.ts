import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { Tool, ToolResult } from '../interfaces/tool.interface';
import { WorkspaceService } from '../../workspace/workspace.service';

const schema = z.object({
  task_id: z.string().uuid(),
  path: z.string().min(1).describe('Relative path inside workspace'),
  content: z.string().describe('File content to write (overwrites existing)'),
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
    const { task_id, path: filePath, content } = schema.parse(input);
    try {
      const safePath = this.workspace.resolveSafePath(task_id, filePath);
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, content, 'utf-8');
      return {
        success: true,
        output: `File written: ${filePath} (${content.length} chars)`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `Cannot write file: ${msg}` };
    }
  }
}
