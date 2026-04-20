import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeDocument } from './knowledge-document.entity';
import { KnowledgeChunk } from './domain/knowledge-chunk.entity';
import { KnowledgeBase } from '../knowledge-base/knowledge-base.entity';
import { PersonaKnowledgeBase } from '../knowledge-base/persona-knowledge-base.entity';
import { KnowledgeService } from './knowledge.service';
import { VectorRetrieverService } from './retrieval/vector-retriever.service';
import { KeywordRetrieverService } from './keyword-retriever.service';
import { FusionService } from './retrieval/fusion.service';
import { HybridRetrievalService } from './retrieval/hybrid-retrieval.service';
import { RerankerService } from './retrieval/reranker.service';
import { QueryRewriteService } from './retrieval/query-rewrite.service';
import { LangSmithTraceService } from './tracing/langsmith-trace.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeDocument,
      KnowledgeChunk,
      KnowledgeBase,
      PersonaKnowledgeBase,
    ]),
  ],
  providers: [
    KnowledgeService,
    VectorRetrieverService,
    KeywordRetrieverService,
    FusionService,
    HybridRetrievalService,
    RerankerService,
    QueryRewriteService,
    LangSmithTraceService,
  ],
  exports: [KnowledgeService, LangSmithTraceService, TypeOrmModule],
})
export class KnowledgeModule {}
