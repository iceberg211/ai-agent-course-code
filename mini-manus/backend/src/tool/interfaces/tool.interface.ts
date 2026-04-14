import { z } from 'zod';

export type ToolErrorCode =
  | 'timeout'
  | 'network'
  | 'tool_input_invalid'
  | 'tool_execution_failed'
  | 'artifact_generation_failed'
  | 'code_execution_failed' // 沙箱运行代码 exitCode≠0，evaluator 看到后直接 replan
  | 'cancelled'
  | 'unknown';

export interface ToolResult {
  success: boolean;
  /** 给 LLM / 人看的自然语言文本 */
  output: string;
  /** 给程序用的结构化数据（JSON），Skill 优先读此字段，不必正则解析 output */
  structuredData?: unknown;
  error?: string;
  errorCode?: ToolErrorCode;
  cached?: boolean;
  metadata?: Record<string, unknown>;
}

/** 工具运行时依赖声明，用于 Planner 过滤不可用工具 */
export type ToolRequirement =
  | 'tavily_api' // 需要 TAVILY_API_KEY
  | 'github_token' // 需要 GITHUB_TOKEN（可选，无 token 时有速率限制）
  | 'docker' // 需要 Docker Engine
  | 'playwright'; // 需要 Playwright 浏览器

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodTypeAny;
  readonly type: 'read-only' | 'side-effect';
  readonly cacheable?: boolean;
  /** 声明运行时依赖，ToolRegistry 据此过滤 Planner 可见的工具列表 */
  readonly requires?: readonly ToolRequirement[];
  execute(input: unknown): Promise<ToolResult>;
}

export const TOOL_OUTPUT_MAX_LENGTH = 20000;

export function truncateOutput(output: string): string {
  if (output.length <= TOOL_OUTPUT_MAX_LENGTH) return output;
  return (
    output.slice(0, TOOL_OUTPUT_MAX_LENGTH) +
    `\n[内容过长已截断，共 ${output.length} 字符，已显示前 ${TOOL_OUTPUT_MAX_LENGTH} 字符]`
  );
}
