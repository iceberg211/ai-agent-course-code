import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { KnowledgeBase } from './knowledge-base.entity';
import { PersonaKnowledgeBase } from './persona-knowledge-base.entity';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { PersonaKnowledgeBaseController } from './persona-knowledge-base.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeBase, PersonaKnowledgeBase]),
    KnowledgeModule,
  ],
  providers: [KnowledgeBaseService],
  controllers: [KnowledgeBaseController, PersonaKnowledgeBaseController],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
