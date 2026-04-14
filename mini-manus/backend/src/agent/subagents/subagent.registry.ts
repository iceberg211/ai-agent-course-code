import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/** SubAgent 能力定义 */
export interface SubAgentDef {
  /** 可使用的工具名列表（不在 ToolRegistry 的工具自动跳过）*/
  tools: string[];
  /** 需要自动注入的参数（从暴露给 LLM 的 schema 中隐藏）*/
  injectArgs?: (taskId: string) => Record<string, unknown>;
  /** System prompt */
  systemPrompt: string;
  /** 是否有写操作（side-effect），用于 HITL 审批判断 */
  isSideEffect?: boolean;
}

/**
 * SubAgent 注册表。
 *
 * 用途：将 SubAgent 定义从硬编码的模块级常量改为可注入、可扩展的注册表。
 * 内置的 researcher / writer 在 AgentModule.onModuleInit 注册；
 * 其他模块可在自身 onModuleInit 中调用 register() 追加新的 SubAgent 类型。
 */
@Injectable()
export class SubAgentRegistry implements OnModuleInit {
  private readonly logger = new Logger(SubAgentRegistry.name);
  private readonly defs = new Map<string, SubAgentDef>();

  onModuleInit() {
    this.logger.log(
      `SubAgentRegistry initialized with ${this.defs.size} agents: [${this.getNames().join(', ')}]`,
    );
  }

  register(name: string, def: SubAgentDef): void {
    this.defs.set(name, def);
    this.logger.debug(`Registered SubAgent: ${name}`);
  }

  get(name: string): SubAgentDef | undefined {
    return this.defs.get(name);
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  getNames(): string[] {
    return [...this.defs.keys()];
  }
}
