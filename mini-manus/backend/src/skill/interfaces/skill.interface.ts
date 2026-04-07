import { z } from 'zod';
import { ToolRegistry } from '../../tool/tool.registry';
import { WorkspaceService } from '../../workspace/workspace.service';
import { ChatOpenAI } from '@langchain/openai';

export type SkillEvent =
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: string }
  | { type: 'reasoning'; content: string }
  | { type: 'progress'; message: string }
  | { type: 'result'; output: unknown };

export interface SkillContext {
  tools: ToolRegistry;
  llm: ChatOpenAI;
  workspace: WorkspaceService;
  signal: AbortSignal;
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
  inputShape: string;
}
