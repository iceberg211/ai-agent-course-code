import { Module, OnModuleInit } from '@nestjs/common';
import { AgentService } from '@/agent/agent.service';
import { ToolModule } from '@/tool/tool.module';
import { SkillModule } from '@/skill/skill.module';
import { WorkspaceModule } from '@/workspace/workspace.module';
import { EventModule } from '@/event/event.module';
import { BrowserModule } from '@/browser/browser.module';
import { WorkflowRegistry, WorkflowBuilder } from '@/agent/workflow.registry';
import { SubAgentRegistry } from '@/agent/subagents/subagent.registry';
import { DETERMINISTIC_WORKFLOWS } from '@/agent/nodes/planner.node';
import { RESEARCHER_DEF, WRITER_DEF } from '@/agent/subagents/react-subagent';

@Module({
  imports: [
    ToolModule,
    SkillModule,
    WorkspaceModule,
    EventModule,
    BrowserModule,
  ],
  providers: [AgentService, WorkflowRegistry, SubAgentRegistry],
  exports: [AgentService],
})
export class AgentModule implements OnModuleInit {
  constructor(
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly subAgentRegistry: SubAgentRegistry,
  ) {}

  onModuleInit() {
    // ─── 注册内置 Workflow ──────────────────────────────────────────────────
    // 新增意图的 workflow：在此调用 workflowRegistry.register()，无需修改 planner.node.ts
    for (const [intent, builder] of Object.entries(DETERMINISTIC_WORKFLOWS)) {
      this.workflowRegistry.register(intent, builder as WorkflowBuilder);
    }

    // ─── 注册内置 SubAgent ──────────────────────────────────────────────────
    // 新增 SubAgent 类型：在此调用 subAgentRegistry.register()，无需修改 react-subagent.ts
    this.subAgentRegistry.register('researcher', RESEARCHER_DEF);
    this.subAgentRegistry.register('writer', WRITER_DEF);
  }
}
