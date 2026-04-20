import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeChunk } from '@/knowledge-content/knowledge-chunk.entity';
import { KnowledgeContentController } from '@/knowledge-content/knowledge-content.controller';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/knowledge-content-runtime.service';
import { KnowledgeContentService } from '@/knowledge-content/knowledge-content.service';
import { KnowledgeDocumentService } from '@/knowledge-content/knowledge-document.service';
import { KnowledgeDocument } from '@/knowledge-content/knowledge-document.entity';
import { KnowledgeSearchService } from '@/knowledge-content/knowledge-search.service';
import { PersonaKnowledgeSearchController } from '@/knowledge-content/persona-knowledge-search.controller';
import { RerankerService } from '@/knowledge-content/reranker.service';
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
    KnowledgeContentRuntimeService,
    KnowledgeDocumentService,
    KnowledgeSearchService,
    KnowledgeContentService,
    RerankerService,
  ],
  controllers: [KnowledgeContentController, PersonaKnowledgeSearchController],
  exports: [KnowledgeContentService],
})
export class KnowledgeContentModule {}
