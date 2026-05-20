import { Module } from '@nestjs/common';
import { LangGraphRagOrchestratorService } from '@/agent/orchestrators/langgraph-rag-orchestrator.service';
import { AnswerGenerationService } from '@/agent/services/generation/answer-generation.service';
import { RAG_ORCHESTRATOR } from '@/agent/agent.constants';
import { EvidenceEvaluatorService } from '@/agent/services/evaluation/evidence-evaluator.service';
import { AgentService } from '@/agent/agent.service';
import { MultiHopPlannerService } from '@/agent/services/planning/multi-hop-planner.service';
import { QueryAugmentationService } from '@/agent/services/query/query-augmentation.service';
import { RagRouteService } from '@/agent/services/planning/rag-route.service';
import { WebFallbackService } from '@/agent/services/query/web-fallback.service';
import { CommonModule } from '@/common/common.module';
import { KnowledgeModule } from '@/knowledge/knowledge.module';
import { PersonaModule } from '@/persona/persona.module';

@Module({
  imports: [
    CommonModule,
    KnowledgeModule,
    PersonaModule,
  ],
  providers: [
    AnswerGenerationService,
    RagRouteService,
    QueryAugmentationService,
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
