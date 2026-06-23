import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common/common.module';
import { KnowledgeController } from '@/knowledge/controllers/knowledge.controller';
import { PersonaKnowledgeController } from '@/knowledge/controllers/persona-knowledge.controller';
import { KnowledgeContentController } from '@/knowledge/controllers/knowledge-content.controller';
import { DocumentManagementController } from '@/knowledge/controllers/document-management.controller';
import { PersonaKnowledgeSearchController } from '@/knowledge/controllers/persona-knowledge-search.controller';
import { Knowledge } from '@/knowledge/entities/knowledge.entity';
import { PersonaKnowledge } from '@/knowledge/entities/persona-knowledge.entity';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeService } from '@/knowledge/services/knowledge.service';
import {
  ElasticsearchIndexService,
  elasticsearchProvider,
} from '@/knowledge/elasticsearch/elasticsearch-index.service';
import { Neo4jGraphService } from '@/knowledge/graph/neo4j-graph.service';
import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';
import { ChunkExpansionService } from '@/knowledge/services/document/chunk-expansion.service';
import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';
import { ContentRuntimeService } from '@/knowledge/services/manage/content-runtime.service';
import { PersonaKnowledgeConfigService } from '@/knowledge/services/manage/persona-knowledge-config.service';
import { KnowledgeSearchService } from '@/knowledge/services/retrieval/pipeline/knowledge-search.service';
import { HybridRetrieverService } from '@/knowledge/services/retrieval/channels/hybrid-retriever.service';
import { QueryRewriteService } from '@/knowledge/services/retrieval/processing/query-rewrite.service';
import { RerankerService } from '@/knowledge/services/retrieval/processing/reranker.service';
import { FulltextRetrieverService } from '@/knowledge/services/retrieval/channels/fulltext-retriever.service';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([
      Knowledge,
      PersonaKnowledge,
      KnowledgeDocument,
      KnowledgeChunk,
    ]),
  ],
  providers: [
    KnowledgeService,
    elasticsearchProvider,
    ElasticsearchIndexService,
    Neo4jGraphService,
    KnowledgeGraphService,
    ChunkExpansionService,
    KnowledgeDocumentService,
    ContentRuntimeService,
    PersonaKnowledgeConfigService,
    KnowledgeSearchService,
    HybridRetrieverService,
    QueryRewriteService,
    RerankerService,
    FulltextRetrieverService,
  ],
  controllers: [
    KnowledgeController,
    DocumentManagementController,
    PersonaKnowledgeController,
    KnowledgeContentController,
    PersonaKnowledgeSearchController,
  ],
  exports: [
    KnowledgeService,
    KnowledgeSearchService,
    QueryRewriteService,
    RerankerService,
    HybridRetrieverService,
  ],
})
export class KnowledgeModule {}
