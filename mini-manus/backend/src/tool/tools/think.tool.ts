import { z } from 'zod';
import { Tool, ToolResult } from '../interfaces/tool.interface';

const schema = z.object({
  thought: z.string().min(1).describe('The reasoning or thinking to record'),
});

export class ThinkTool implements Tool {
  readonly name = 'think';
  readonly description =
    'Record internal reasoning without calling external systems. Use for analysis, planning, or summarizing before acting.';
  readonly schema = schema;
  readonly type = 'read-only' as const;

  execute(input: unknown): Promise<ToolResult> {
    const { thought } = schema.parse(input);
    return Promise.resolve({ success: true, output: thought });
  }
}
