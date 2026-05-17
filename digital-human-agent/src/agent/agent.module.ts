import { Module } from '@nestjs/common';
import { LangGraphRagOrchestratorService } from '@/agent/orchestrators/langgraph-rag-orchestrator.service';
import { AnswerGenerationService } from '@/agent/services/answer-generation.service';
import { RAG_ORCHESTRATOR } from '@/agent/agent.constants';
import { EvidenceEvaluatorService } from '@/agent/services/evidence-evaluator.service';
import { AgentService } from '@/agent/agent.service';
import { MultiHopPlannerService } from '@/agent/services/multi-hop-planner.service';
import { RagRouteService } from '@/agent/services/rag-route.service';
import { RetrievalStrategyService } from '@/agent/services/retrieval-strategy.service';
import { WebFallbackService } from '@/agent/services/web-fallback.service';
import { CommonModule } from '@/common/common.module';
import { ConversationModule } from '@/conversation/conversation.module';
import { KnowledgeContentModule } from '@/knowledge-content/knowledge-content.module';
import { PersonaModule } from '@/persona/persona.module';

@Module({
  imports: [
    CommonModule,
    KnowledgeContentModule,
    PersonaModule,
    ConversationModule,
  ],
  providers: [
    AnswerGenerationService,
    RagRouteService,
    RetrievalStrategyService,
    MultiHopPlannerService,
    EvidenceEvaluatorService,
    WebFallbackService,
    LangGraphRagOrchestratorService,
    {
      provide: RAG_ORCHESTRATOR,
      useExisting: LangGraphRagOrchestratorService,
    },
    AgentService,
  ],
  exports: [AgentService],
})
export class AgentModule {}
