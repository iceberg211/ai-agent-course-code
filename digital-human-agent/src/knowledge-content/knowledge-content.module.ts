import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeDocument } from './knowledge-document.entity';
import { KnowledgeChunk } from './knowledge-chunk.entity';
import { KnowledgeBase } from '../knowledge-base/knowledge-base.entity';
import { PersonaKnowledgeBase } from '../knowledge-base/persona-knowledge-base.entity';
import { KnowledgeContentController } from './knowledge-content.controller';
import { KnowledgeContentService } from './knowledge-content.service';
import { PersonaKnowledgeSearchController } from './persona-knowledge-search.controller';
import { RerankerService } from './reranker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeDocument,
      KnowledgeChunk,
      KnowledgeBase,
      PersonaKnowledgeBase,
    ]),
  ],
  providers: [KnowledgeContentService, RerankerService],
  controllers: [KnowledgeContentController, PersonaKnowledgeSearchController],
  exports: [KnowledgeContentService],
})
export class KnowledgeContentModule {}
