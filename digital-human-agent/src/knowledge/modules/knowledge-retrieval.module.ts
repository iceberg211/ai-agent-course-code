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
import { KnowledgeDocumentModule } from './knowledge-document.module';
import { KnowledgeGraphModule } from './knowledge-graph.module';
import { KnowledgeBaseModule } from './knowledge-base.module';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([KnowledgeChunk]),
    KnowledgeDocumentModule,
    KnowledgeGraphModule,
    KnowledgeBaseModule,
  ],
  providers: [
    KnowledgeSearchService,
    HybridRetrieverService,
    FulltextRetrieverService,
    QueryRewriteService,
    RerankerService,
  ],
  controllers: [
    KnowledgeSearchController,
  ],
  exports: [
    KnowledgeSearchService,
    HybridRetrieverService,
    QueryRewriteService,
    RerankerService,
  ],
})
export class KnowledgeRetrievalModule {}
