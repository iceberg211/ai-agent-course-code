import { Module } from '@nestjs/common';
import { AgentService } from '@/agent/agent.service';
import { ToolModule } from '@/tool/tool.module';
import { SkillModule } from '@/skill/skill.module';
import { WorkspaceModule } from '@/workspace/workspace.module';
import { EventModule } from '@/event/event.module';

@Module({
  imports: [ToolModule, SkillModule, WorkspaceModule, EventModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
