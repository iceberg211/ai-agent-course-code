import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common/common.module';
import { Knowledge } from '@/knowledge/entities/knowledge.entity';
import { PersonaKnowledge } from '@/knowledge/entities/persona-knowledge.entity';
import { KnowledgeController } from '@/knowledge/controllers/knowledge.controller';
import { PersonaKnowledgeController } from '@/knowledge/controllers/persona-knowledge.controller';
import { PersonaKnowledgeSearchController } from '@/knowledge/controllers/persona-knowledge-search.controller';
import { KnowledgeService } from '@/knowledge/services/knowledge.service';
import { PersonaKnowledgeConfigService } from '@/knowledge/services/manage/persona-knowledge-config.service';
import { KnowledgeDocumentModule } from './knowledge-document.module';
import { KnowledgeRetrievalModule } from './knowledge-retrieval.module';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([Knowledge, PersonaKnowledge]),
    KnowledgeDocumentModule,
    forwardRef(() => KnowledgeRetrievalModule),
  ],
  providers: [
    KnowledgeService,
    PersonaKnowledgeConfigService,
  ],
  controllers: [
    KnowledgeController,
    PersonaKnowledgeController,
    PersonaKnowledgeSearchController,
  ],
  exports: [
    KnowledgeService,
    PersonaKnowledgeConfigService,
  ],
})
export class KnowledgeBaseModule {}
