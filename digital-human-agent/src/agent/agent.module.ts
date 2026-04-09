import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PersonaModule } from '../persona/persona.module';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [KnowledgeModule, PersonaModule, ConversationModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
