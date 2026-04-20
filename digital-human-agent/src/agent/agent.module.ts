import { Module } from '@nestjs/common';
import { AgentService } from '@/agent/agent.service';
import { ConversationModule } from '@/conversation/conversation.module';
import { KnowledgeContentModule } from '@/knowledge-content/knowledge-content.module';
import { PersonaModule } from '@/persona/persona.module';

@Module({
  imports: [KnowledgeContentModule, PersonaModule, ConversationModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
