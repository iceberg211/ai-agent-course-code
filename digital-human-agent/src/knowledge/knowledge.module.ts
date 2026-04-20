import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeController } from '@/knowledge/knowledge.controller';
import { Knowledge } from '@/knowledge/knowledge.entity';
import { KnowledgeService } from '@/knowledge/knowledge.service';
import { PersonaKnowledgeController } from '@/knowledge/persona-knowledge.controller';
import { PersonaKnowledge } from '@/knowledge/persona-knowledge.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Knowledge, PersonaKnowledge])],
  providers: [KnowledgeService],
  controllers: [KnowledgeController, PersonaKnowledgeController],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
