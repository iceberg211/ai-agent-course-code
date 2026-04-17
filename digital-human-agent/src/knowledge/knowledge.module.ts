import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeDocument } from './knowledge-document.entity';
import { KnowledgeChunk } from './knowledge-chunk.entity';
import { KnowledgeBase } from '../knowledge-base/knowledge-base.entity';
import { PersonaKnowledgeBase } from '../knowledge-base/persona-knowledge-base.entity';
import { KnowledgeService } from './knowledge.service';
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
  providers: [KnowledgeService, RerankerService],
  exports: [KnowledgeService, TypeOrmModule],
})
export class KnowledgeModule {}
