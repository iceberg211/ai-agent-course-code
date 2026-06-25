import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common/common.module';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { KnowledgeDocumentController } from '@/knowledge/controllers/knowledge-document.controller';
import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';
import { ChunkExpansionService } from '@/knowledge/services/document/chunk-expansion.service';
import { RagRuntimeService } from '@/knowledge/services/manage/rag-runtime.service';
import {
  ElasticsearchIndexService,
  elasticsearchProvider,
} from '@/knowledge/elasticsearch/elasticsearch-index.service';
import { NotificationModule } from '@/notification/notification.module';
import { KnowledgeGraphModule } from './knowledge-graph.module';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([KnowledgeDocument, KnowledgeChunk]),
    KnowledgeGraphModule,
    NotificationModule,
  ],
  providers: [
    KnowledgeDocumentService,
    ChunkExpansionService,
    RagRuntimeService,
    elasticsearchProvider,
    ElasticsearchIndexService,
  ],
  controllers: [KnowledgeDocumentController],
  exports: [
    KnowledgeDocumentService,
    RagRuntimeService,
    elasticsearchProvider,
    ElasticsearchIndexService,
  ],
})
export class KnowledgeDocumentModule {}
