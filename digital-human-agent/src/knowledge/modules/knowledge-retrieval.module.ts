import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common/common.module';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeSearchController } from '@/knowledge/controllers/knowledge-search.controller';
import { KnowledgeSearchService } from '@/knowledge/services/retrieval/pipeline/knowledge-search.service';
import { HybridRetrieverService } from '@/knowledge/services/retrieval/channels/hybrid-retriever.service';
import { FulltextRetrieverService } from '@/knowledge/services/retrieval/channels/fulltext-retriever.service';
import { QueryRewriteService } from '@/knowledge/services/retrieval/processing/query-rewrite.service';
import { RerankerService } from '@/knowledge/services/retrieval/processing/reranker.service';
import { LlmRerankerProvider } from '@/knowledge/services/retrieval/processing/llm-reranker.provider';
import { NoopRerankerProvider } from '@/knowledge/services/retrieval/processing/noop-reranker.provider';
import { KnowledgeDocumentModule } from './knowledge-document.module';
import { KnowledgeGraphModule } from './knowledge-graph.module';
import { KnowledgeBaseModule } from './knowledge-base.module';
import { RbacModule } from '@/rbac/rbac.module';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([KnowledgeChunk]),
    KnowledgeDocumentModule,
    KnowledgeGraphModule,
    KnowledgeBaseModule,
    RbacModule,
  ],
  providers: [
    KnowledgeSearchService,
    HybridRetrieverService,
    FulltextRetrieverService,
    QueryRewriteService,
    RerankerService,
    LlmRerankerProvider,
    NoopRerankerProvider,
  ],
  controllers: [
    KnowledgeSearchController,
  ],
  exports: [
    KnowledgeSearchService,
    HybridRetrieverService,
    QueryRewriteService,
    RerankerService,
    LlmRerankerProvider,
    NoopRerankerProvider,
  ],
})
export class KnowledgeRetrievalModule {}
