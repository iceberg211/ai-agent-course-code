import { Module } from '@nestjs/common';
import { LangGraphRagOrchestratorService } from '@/agent/orchestrators/langgraph-rag-orchestrator.service';
import { AnswerGenerationService } from '@/agent/services/answer-generation.service';
import { RAG_ORCHESTRATOR } from '@/agent/agent.constants';
import { EvidenceEvaluatorService } from '@/agent/services/evidence-evaluator.service';
import { AgentService } from '@/agent/agent.service';
import { MultiHopPlannerService } from '@/agent/services/multi-hop-planner.service';
import { QueryAugmentationService } from '@/agent/services/query-augmentation.service';
import { RagRouteService } from '@/agent/services/rag-route.service';
import { WebFallbackService } from '@/agent/services/web-fallback.service';
import { CommonModule } from '@/common/common.module';
import { KnowledgeModule } from '@/knowledge/knowledge.module';
import { PersonaModule } from '@/persona/persona.module';
import { MemoryModule } from '@/memory/memory.module';

@Module({
  imports: [
    CommonModule,
    KnowledgeModule,
    PersonaModule,
    MemoryModule,
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
