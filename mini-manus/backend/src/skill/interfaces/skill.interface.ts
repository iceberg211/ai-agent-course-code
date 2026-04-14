import { z } from 'zod';
import { ToolRegistry } from '@/tool/tool.registry';
import { WorkspaceService } from '@/workspace/workspace.service';
import { ChatOpenAI } from '@langchain/openai';

export type SkillEvent =
  | { type: 'tool_call'; tool: string; input: unknown }
  | {
      type: 'tool_result';
      tool: string;
      output: string;
      cached?: boolean;
      error?: string | null;
      errorCode?: string | null;
    }
  | { type: 'reasoning'; content: string }
  | { type: 'progress'; message: string }
  | { type: 'result'; output: unknown };

export interface SkillContext {
  tools: ToolRegistry;
  llm: ChatOpenAI;
  workspace: WorkspaceService;
  signal: AbortSignal;
  soMethod: 'functionCalling' | 'json_schema' | 'jsonMode';
  // ── 可选上下文字段（向后兼容，现有 Skill 无需修改）──
  /** 当前任务 ID，需要写文件的 Skill 可直接使用 */
  taskId?: string;
  /** 前序步骤的简短描述列表，Skill 可据此调整策略 */
  priorStepSummaries?: string[];
  /** 粗估剩余 token 预算，Skill 可据此控制搜索深度 */
  remainingBudgetHint?: number;
}

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly outputSchema: z.ZodTypeAny;
  readonly effect: 'read-only' | 'side-effect';
  execute(input: unknown, context: SkillContext): AsyncGenerator<SkillEvent>;
}

export interface SkillForPlanner {
  name: string;
  description: string;
  effect: Skill['effect'];
  inputShape: string;
}
