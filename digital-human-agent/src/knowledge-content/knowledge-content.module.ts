import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { KnowledgeGraphBackfillService } from '@/knowledge-content/graph/knowledge-graph-backfill.service';
import { KnowledgeGraphExtractorService } from '@/knowledge-content/graph/knowledge-graph-extractor.service';
import { KnowledgeGraphRetrieverService } from '@/knowledge-content/graph/knowledge-graph-retriever.service';
import { KnowledgeGraphSyncService } from '@/knowledge-content/graph/knowledge-graph-sync.service';
import { KnowledgeParentChildBackfillService } from '@/knowledge-content/parent-child/knowledge-parent-child-backfill.service';
import { KnowledgeParentChildSyncService } from '@/knowledge-content/parent-child/knowledge-parent-child-sync.service';
import { ElasticKeywordRetrieverService } from '@/knowledge-content/keyword-retrievers/elastic-keyword-retriever.service';
import { PgKeywordRetrieverService } from '@/knowledge-content/keyword-retrievers/pg-keyword-retriever.service';
import { KnowledgeContextualRetrievalService } from '@/knowledge-content/services/knowledge-contextual-retrieval.service';
import { KnowledgeChunkContextExpansionService } from '@/knowledge-content/services/knowledge-chunk-context-expansion.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import { KnowledgeContentService } from '@/knowledge-content/services/knowledge-content.service';
import { KnowledgeDocumentService } from '@/knowledge-content/services/knowledge-document.service';
import { KnowledgeHybridRetrieverService } from '@/knowledge-content/services/knowledge-hybrid-retriever.service';
import { KnowledgeKeywordRetrieverService } from '@/knowledge-content/services/knowledge-keyword-retriever.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import { KnowledgeVectorRetrieverService } from '@/knowledge-content/services/knowledge-vector-retriever.service';
import { QueryRewriteService } from '@/knowledge-content/services/query-rewrite.service';
import { RerankerService } from '@/knowledge-content/services/reranker.service';
import { DashScopeQwenRerankerProvider } from '@/knowledge-content/rerankers/dashscope-qwen-reranker.provider';
import { LlmJsonRerankerProvider } from '@/knowledge-content/rerankers/llm-json-reranker.provider';
import { Knowledge } from '@/knowledge/knowledge.entity';
import { PersonaKnowledge } from '@/knowledge/persona-knowledge.entity';

@Module({
  imports: [
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
    KnowledgeGraphBackfillService,
    KnowledgeGraphExtractorService,
    KnowledgeGraphRetrieverService,
    KnowledgeGraphSyncService,
    KnowledgeParentChildBackfillService,
    KnowledgeParentChildSyncService,
    KnowledgeElasticsearchBackfillService,
    KnowledgeContextualRetrievalService,
    KnowledgeChunkContextExpansionService,
    KnowledgeContentRuntimeService,
    KnowledgeDocumentService,
    KnowledgeVectorRetrieverService,
    PgKeywordRetrieverService,
    ElasticKeywordRetrieverService,
    KnowledgeKeywordRetrieverService,
    KnowledgeHybridRetrieverService,
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
