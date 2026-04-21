import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeContentController } from '@/knowledge-content/controllers/knowledge-content.controller';
import { PersonaKnowledgeSearchController } from '@/knowledge-content/controllers/persona-knowledge-search.controller';
import { KnowledgeChunk } from '@/knowledge-content/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '@/knowledge-content/entities/knowledge-document.entity';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import { KnowledgeContentService } from '@/knowledge-content/services/knowledge-content.service';
import { KnowledgeDocumentService } from '@/knowledge-content/services/knowledge-document.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import { QueryRewriteService } from '@/knowledge-content/services/query-rewrite.service';
import { RerankerService } from '@/knowledge-content/services/reranker.service';
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
    QueryRewriteService,
    RerankerService,
  ],
  controllers: [KnowledgeContentController, PersonaKnowledgeSearchController],
  exports: [KnowledgeContentService],
})
export class KnowledgeContentModule {}
