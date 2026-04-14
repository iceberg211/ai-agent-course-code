import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AgentState, PlanStepDef } from '@/agent/agent.state';
import type { SkillRegistry } from '@/skill/skill.registry';
import type { ToolRegistry } from '@/tool/tool.registry';

export interface WorkflowContext {
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
}

export type WorkflowBuilder = (
  state: AgentState,
  ctx: WorkflowContext,
) => PlanStepDef[];

/**
 * Workflow 注册表。
 *
 * 用途：将确定性 Workflow 从 planner.node.ts 的模块级常量改为可注入、可扩展的注册表。
 * 内置的 code_generation / research_report / competitive_analysis 在 AgentModule.onModuleInit 注册；
 * 其他模块可在自身 onModuleInit 中调用 register() 追加新的意图 workflow，
 * 无需修改 planner.node.ts。
 */
@Injectable()
export class WorkflowRegistry implements OnModuleInit {
  private readonly logger = new Logger(WorkflowRegistry.name);
  private readonly workflows = new Map<string, WorkflowBuilder>();

  onModuleInit() {
    this.logger.log(
      `WorkflowRegistry initialized with ${this.workflows.size} workflows: [${this.getIntents().join(', ')}]`,
    );
  }

  register(intent: string, builder: WorkflowBuilder): void {
    this.workflows.set(intent, builder);
    this.logger.debug(`Registered workflow: ${intent}`);
  }

  get(intent: string): WorkflowBuilder | undefined {
    return this.workflows.get(intent);
  }

  has(intent: string): boolean {
    return this.workflows.has(intent);
  }

  /** 返回所有已注册的意图名称（供 Router 动态构建 enum 等用途）*/
  getIntents(): string[] {
    return [...this.workflows.keys()];
  }
}
