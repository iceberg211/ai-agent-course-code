import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Tool, ToolResult } from '@/tool/interfaces/tool.interface';
import { classifyToolError } from '@/tool/utils/tool-error';
import { SandboxService } from '@/sandbox/sandbox.service';

const schema = z.object({
  task_id: z.string().uuid(),
  entry: z
    .string()
    .min(1)
    .describe('相对于 task workspace 的 Node.js 入口文件路径，如 project/index.js'),
  timeout_ms: z
    .number()
    .int()
    .min(1000)
    .max(120_000)
    .default(30_000)
    .optional()
    .describe('执行超时（毫秒），默认 30s，最大 120s'),
});

@Injectable()
export class SandboxRunNodeTool implements Tool {
  readonly name = 'sandbox_run_node';
  readonly description =
    '在隔离 Docker 沙箱中运行 Node.js 脚本（无网络、只挂载当前 task workspace），' +
    '捕获 stdout / stderr / exitCode，适合验证代码生成结果。';
  readonly schema = schema;
  readonly type = 'side-effect' as const;

  constructor(private readonly sandbox: SandboxService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const { task_id, entry, timeout_ms } = schema.parse(input);
      const result = await this.sandbox.run({
        taskId: task_id,
        runtime: 'node',
        entryFile: entry,
        timeoutMs: timeout_ms ?? 30_000,
      });

      const lines: string[] = [
        `exitCode: ${result.exitCode}`,
        `duration: ${result.durationMs}ms`,
      ];
      if (result.stdout) lines.push(`stdout:\n${result.stdout}`);
      if (result.stderr) lines.push(`stderr:\n${result.stderr}`);
      if (result.truncated) lines.push('（输出已截断）');

      return {
        success: result.exitCode === 0,
        output: lines.join('\n'),
        error: result.exitCode !== 0 ? `exitCode=${result.exitCode}` : undefined,
        errorCode: result.exitCode !== 0 ? 'tool_execution_failed' : undefined,
        metadata: {
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          truncated: result.truncated,
        },
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'sandbox_timeout') {
        return {
          success: false,
          output: '',
          error: 'Node.js 脚本执行超时',
          errorCode: 'timeout',
        };
      }
      return classifyToolError(err, 'sandbox_run_node failed');
    }
  }
}
