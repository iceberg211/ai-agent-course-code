import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeDocument } from './knowledge-document.entity';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { RerankerService } from './reranker.service';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeDocument])],
  providers: [KnowledgeService, RerankerService],
  controllers: [KnowledgeController],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
