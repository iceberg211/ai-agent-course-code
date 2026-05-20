import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common/common.module';
import { KnowledgeController } from '@/knowledge/controllers/knowledge.controller';
import { PersonaKnowledgeController } from '@/knowledge/controllers/persona-knowledge.controller';
import { KnowledgeContentController } from '@/knowledge/controllers/knowledge-content.controller';
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
import { KnowledgeChunkContextExpansionService } from '@/knowledge/services/document/knowledge-chunk-context-expansion.service';
import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';
import { KnowledgeContentRuntimeService } from '@/knowledge/services/manage/knowledge-content-runtime.service';
import { KnowledgeContentService } from '@/knowledge/services/manage/knowledge-content.service';
import { PersonaKnowledgeConfigService } from '@/knowledge/services/manage/persona-knowledge-config.service';
import { KnowledgeKeywordRetrieverService } from '@/knowledge/services/retrieval/knowledge-keyword-retriever.service';
import { KnowledgeSearchService } from '@/knowledge/services/retrieval/knowledge-search.service';
import { KnowledgeHybridRetrieverService } from '@/knowledge/services/retrieval/knowledge-hybrid-retriever.service';
import { QueryRewriteService } from '@/knowledge/services/retrieval/query-rewrite.service';
import { RerankerService } from '@/knowledge/services/retrieval/reranker.service';

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
    KnowledgeChunkContextExpansionService,
    KnowledgeDocumentService,
    KnowledgeContentRuntimeService,
    KnowledgeContentService,
    PersonaKnowledgeConfigService,
    KnowledgeKeywordRetrieverService,
    KnowledgeSearchService,
    KnowledgeHybridRetrieverService,
    QueryRewriteService,
    RerankerService,
  ],
  controllers: [
    KnowledgeController,
    PersonaKnowledgeController,
    KnowledgeContentController,
    PersonaKnowledgeSearchController,
  ],
  exports: [
    KnowledgeService,
    KnowledgeContentService,
    KnowledgeSearchService,
    QueryRewriteService,
    RerankerService,
    KnowledgeHybridRetrieverService,
  ],
})
export class KnowledgeModule {}
