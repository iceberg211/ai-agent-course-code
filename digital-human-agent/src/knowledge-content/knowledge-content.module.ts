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
import { KnowledgeChunkContextExpansionService } from '@/knowledge-content/services/document/knowledge-chunk-context-expansion.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/manage/knowledge-content-runtime.service';
import { KnowledgeContentService } from '@/knowledge-content/services/manage/knowledge-content.service';
import { KnowledgeDocumentService } from '@/knowledge-content/services/document/knowledge-document.service';
import { KnowledgeKeywordRetrieverService } from '@/knowledge-content/services/retrieval/knowledge-keyword-retriever.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/retrieval/knowledge-search.service';
import { KnowledgeHybridRetrieverService } from '@/knowledge-content/services/retrieval/knowledge-hybrid-retriever.service';
import { PersonaKnowledgeConfigService } from '@/knowledge-content/services/manage/persona-knowledge-config.service';
import { QueryRewriteService } from '@/knowledge-content/services/retrieval/query-rewrite.service';
import { RerankerService } from '@/knowledge-content/services/retrieval/reranker.service';
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
    KnowledgeHybridRetrieverService,
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
    KnowledgeHybridRetrieverService,
  ],
})
export class KnowledgeContentModule {}
