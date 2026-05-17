import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common/common.module';
import { KnowledgeContentController } from '@/knowledge-content/controllers/knowledge-content.controller';
import { PersonaKnowledgeSearchController } from '@/knowledge-content/controllers/persona-knowledge-search.controller';
import { RagSemanticCacheStoreService } from '@/knowledge-content/cache/rag-semantic-cache-store.service';
import { KnowledgeChunk } from '@/knowledge-content/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge-content/entities/knowledge-document.entity';
import { KnowledgeElasticsearchBackfillService } from '@/knowledge-content/backfill/knowledge-elasticsearch-backfill.service';
import { ElasticsearchIndexService } from '@/knowledge-content/elasticsearch/elasticsearch-index.service';
import { elasticsearchProvider } from '@/knowledge-content/elasticsearch/elasticsearch.provider';
import { ElasticsearchSyncService } from '@/knowledge-content/elasticsearch/elasticsearch-sync.service';
import { KnowledgeChunkIndexQueryService } from '@/knowledge-content/elasticsearch/knowledge-chunk-index-query.service';
import { KnowledgeGraphExtractorService } from '@/knowledge-content/graph/knowledge-graph-extractor.service';
import { Neo4jGraphBackfillService } from '@/knowledge-content/graph/neo4j-graph-backfill.service';
import { Neo4jGraphRetrieverService } from '@/knowledge-content/graph/neo4j-graph-retriever.service';
import { Neo4jGraphService } from '@/knowledge-content/graph/neo4j-graph.service';
import { Neo4jGraphSyncService } from '@/knowledge-content/graph/neo4j-graph-sync.service';
import { KnowledgeParentChildBackfillService } from '@/knowledge-content/parent-child/knowledge-parent-child-backfill.service';
import { KnowledgeParentChildSyncService } from '@/knowledge-content/parent-child/knowledge-parent-child-sync.service';
import { ElasticKeywordRetrieverService } from '@/knowledge-content/keyword-retrievers/elastic-keyword-retriever.service';
import { PgKeywordRetrieverService } from '@/knowledge-content/keyword-retrievers/pg-keyword-retriever.service';
import { KnowledgeContextualRetrievalService } from '@/knowledge-content/services/knowledge-contextual-retrieval.service';
import { KnowledgeChunkContextExpansionService } from '@/knowledge-content/services/knowledge-chunk-context-expansion.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import { KnowledgeContentService } from '@/knowledge-content/services/knowledge-content.service';
import { KnowledgeDocumentIndexSyncService } from '@/knowledge-content/services/knowledge-document-index-sync.service';
import { KnowledgeDocumentService } from '@/knowledge-content/services/knowledge-document.service';
import { KnowledgeHybridRetrieverService } from '@/knowledge-content/services/knowledge-hybrid-retriever.service';
import { KnowledgeKeywordRetrieverService } from '@/knowledge-content/services/knowledge-keyword-retriever.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import { KnowledgeStage1RetrievalService } from '@/knowledge-content/services/knowledge-stage1-retrieval.service';
import { KnowledgeVectorRetrieverService } from '@/knowledge-content/services/knowledge-vector-retriever.service';
import { PersonaKnowledgeConfigService } from '@/knowledge-content/services/persona-knowledge-config.service';
import { RagSemanticCacheCoordinatorService } from '@/knowledge-content/services/rag-semantic-cache-coordinator.service';
import { QueryRewriteService } from '@/knowledge-content/services/query-rewrite.service';
import { RerankerService } from '@/knowledge-content/services/reranker.service';
import { DashScopeQwenRerankerProvider } from '@/knowledge-content/rerankers/dashscope-qwen-reranker.provider';
import { LlmJsonRerankerProvider } from '@/knowledge-content/rerankers/llm-json-reranker.provider';
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
    ElasticsearchSyncService,
    KnowledgeChunkIndexQueryService,
    KnowledgeGraphExtractorService,
    Neo4jGraphService,
    Neo4jGraphBackfillService,
    Neo4jGraphRetrieverService,
    Neo4jGraphSyncService,
    KnowledgeParentChildBackfillService,
    KnowledgeParentChildSyncService,
    KnowledgeElasticsearchBackfillService,
    KnowledgeContextualRetrievalService,
    KnowledgeChunkContextExpansionService,
    KnowledgeContentRuntimeService,
    KnowledgeDocumentIndexSyncService,
    KnowledgeDocumentService,
    KnowledgeVectorRetrieverService,
    PgKeywordRetrieverService,
    ElasticKeywordRetrieverService,
    KnowledgeKeywordRetrieverService,
    KnowledgeHybridRetrieverService,
    KnowledgeStage1RetrievalService,
    PersonaKnowledgeConfigService,
    RagSemanticCacheCoordinatorService,
    KnowledgeSearchService,
    KnowledgeContentService,
    QueryRewriteService,
    DashScopeQwenRerankerProvider,
    LlmJsonRerankerProvider,
    RerankerService,
    RagSemanticCacheStoreService,
  ],
  controllers: [KnowledgeContentController, PersonaKnowledgeSearchController],
  exports: [KnowledgeContentService, KnowledgeSearchService],
})
export class KnowledgeContentModule {}
