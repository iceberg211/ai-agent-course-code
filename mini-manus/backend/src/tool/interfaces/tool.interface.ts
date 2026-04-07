import { z } from 'zod';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodTypeAny;
  readonly type: 'read-only' | 'side-effect';
  execute(input: unknown): Promise<ToolResult>;
}

export const TOOL_OUTPUT_MAX_LENGTH = 5000;

export function truncateOutput(output: string): string {
  if (output.length <= TOOL_OUTPUT_MAX_LENGTH) return output;
  return (
    output.slice(0, TOOL_OUTPUT_MAX_LENGTH) +
    `\n[内容过长已截断，共 ${output.length} 字符，已显示前 ${TOOL_OUTPUT_MAX_LENGTH} 字符]`
  );
}
