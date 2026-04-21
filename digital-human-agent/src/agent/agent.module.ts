import { Module } from '@nestjs/common';
import { AnswerGenerationService } from '@/agent/answer-generation.service';
import { RAG_ORCHESTRATOR } from '@/agent/agent.constants';
import { DefaultRagOrchestratorService } from '@/agent/default-rag-orchestrator.service';
import { AgentService } from '@/agent/agent.service';
import { MultiHopPlannerService } from '@/agent/multi-hop-planner.service';
import { RagRouteService } from '@/agent/rag-route.service';
import { ConversationModule } from '@/conversation/conversation.module';
import { KnowledgeContentModule } from '@/knowledge-content/knowledge-content.module';
import { PersonaModule } from '@/persona/persona.module';

@Module({
  imports: [KnowledgeContentModule, PersonaModule, ConversationModule],
  providers: [
    AnswerGenerationService,
    RagRouteService,
    MultiHopPlannerService,
    DefaultRagOrchestratorService,
    {
      provide: RAG_ORCHESTRATOR,
      useExisting: DefaultRagOrchestratorService,
    },
    AgentService,
  ],
  exports: [AgentService],
})
export class AgentModule {}
