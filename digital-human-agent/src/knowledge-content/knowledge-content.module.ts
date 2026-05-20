import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common/common.module';
import { KnowledgeContentController } from '@/knowledge-content/controllers/knowledge-content.controller';
import { PersonaKnowledgeSearchController } from '@/knowledge-content/controllers/persona-knowledge-search.controller';
import { KnowledgeChunk } from '@/knowledge-content/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge-content/entities/knowledge-document.entity';
import {
  ElasticsearchIndexService,
  elasticsearchProvider,
} from '@/knowledge-content/elasticsearch/elasticsearch-index.service';
import { Neo4jGraphService } from '@/knowledge-content/graph/neo4j-graph.service';
import { KnowledgeGraphService } from '@/knowledge-content/graph/knowledge-graph.service';
import { KnowledgeChunkContextExpansionService } from '@/knowledge-content/services/knowledge-chunk-context-expansion.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import { KnowledgeContentService } from '@/knowledge-content/services/knowledge-content.service';
import { KnowledgeDocumentService } from '@/knowledge-content/services/knowledge-document.service';
import { KnowledgeKeywordRetrieverService } from '@/knowledge-content/services/knowledge-keyword-retriever.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import { KnowledgeStage1RetrievalService } from '@/knowledge-content/services/knowledge-stage1-retrieval.service';
import { PersonaKnowledgeConfigService } from '@/knowledge-content/services/persona-knowledge-config.service';
import { QueryRewriteService } from '@/knowledge-content/services/query-rewrite.service';
import { RerankerService } from '@/knowledge-content/services/reranker.service';
import { Knowledge } from '@/knowledge/knowledge.entity';
import { PersonaKnowledge } from '@/knowledge/persona-knowledge.entity';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([
      KnowledgeDocument,
      KnowledgeChunk,
      Knowledge,
      PersonaKnowledge,
    ]),
  ],
  providers: [
    elasticsearchProvider,
    ElasticsearchIndexService,
    Neo4jGraphService,
    KnowledgeGraphService,
    KnowledgeChunkContextExpansionService,
    KnowledgeContentRuntimeService,
    KnowledgeDocumentService,
    KnowledgeKeywordRetrieverService,
    KnowledgeStage1RetrievalService,
    PersonaKnowledgeConfigService,
    KnowledgeSearchService,
    KnowledgeContentService,
    QueryRewriteService,
    RerankerService,
  ],
  controllers: [KnowledgeContentController, PersonaKnowledgeSearchController],
  exports: [
    KnowledgeContentService,
    KnowledgeSearchService,
    QueryRewriteService,
    RerankerService,
    KnowledgeStage1RetrievalService,
  ],
})
export class KnowledgeContentModule {}
