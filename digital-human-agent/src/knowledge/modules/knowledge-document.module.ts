import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common/common.module';
import { KnowledgeDocument } from '@/knowledge/entities/knowledge-document.entity';
import { KnowledgeChunk } from '@/knowledge/entities/knowledge-chunk.entity';
import { DocumentTask } from '@/knowledge/entities/document-task.entity';
import { DocumentTaskStep } from '@/knowledge/entities/document-task-step.entity';
import { DocumentAsset } from '@/knowledge/entities/document-asset.entity';
import { KnowledgeDocumentController } from '@/knowledge/controllers/knowledge-document.controller';
import { KnowledgeDocumentService } from '@/knowledge/services/document/knowledge-document.service';
import { DocumentTaskService } from '@/knowledge/services/document/document-task.service';
import { DocumentTaskRunnerService } from '@/knowledge/services/document/document-task-runner.service';
import { DocumentTaskWorkerService } from '@/knowledge/services/document/document-task-worker.service';
import { ChunkExpansionService } from '@/knowledge/services/document/chunk-expansion.service';
import { RagRuntimeService } from '@/knowledge/services/manage/rag-runtime.service';
import {
  ElasticsearchIndexService,
  elasticsearchProvider,
} from '@/knowledge/elasticsearch/elasticsearch-index.service';
import { NotificationModule } from '@/notification/notification.module';
import { KnowledgeGraphModule } from './knowledge-graph.module';
import { QueueModule } from '@/queue/queue.module';
import { StorageModule } from '@/storage/storage.module';

// 导入多模态解析器
import { PlainTextParser } from '@/knowledge/services/document/parsers/plain-text.parser';
import { PdfParser } from '@/knowledge/services/document/parsers/pdf.parser';
import { OfficeParser } from '@/knowledge/services/document/parsers/office.parser';
import { ImageOcrParser } from '@/knowledge/services/document/parsers/image-ocr.parser';
import { AudioAsrParser } from '@/knowledge/services/document/parsers/audio-asr.parser';
import { VideoParser } from '@/knowledge/services/document/parsers/video.parser';
import { WebPageParser } from '@/knowledge/services/document/parsers/web-page.parser';
import { DocumentParserService } from '@/knowledge/services/document/parsers/document-parser.service';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([
      KnowledgeDocument,
      KnowledgeChunk,
      DocumentTask,
      DocumentTaskStep,
      DocumentAsset,
    ]),
    KnowledgeGraphModule,
    NotificationModule,
    QueueModule,
    StorageModule,
  ],
  providers: [
    KnowledgeDocumentService,
    DocumentTaskService,
    DocumentTaskRunnerService,
    DocumentTaskWorkerService,
    ChunkExpansionService,
    RagRuntimeService,
    elasticsearchProvider,
    ElasticsearchIndexService,
    // 注册解析器
    PlainTextParser,
    PdfParser,
    OfficeParser,
    ImageOcrParser,
    AudioAsrParser,
    VideoParser,
    WebPageParser,
    DocumentParserService,
  ],
  controllers: [KnowledgeDocumentController],
  exports: [
    KnowledgeDocumentService,
    DocumentTaskService,
    DocumentTaskRunnerService,
    DocumentTaskWorkerService,
    RagRuntimeService,
    elasticsearchProvider,
    ElasticsearchIndexService,
    DocumentParserService,
  ],
})
export class KnowledgeDocumentModule {}
