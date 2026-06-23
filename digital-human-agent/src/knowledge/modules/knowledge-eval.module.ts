import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '@/common/common.module';
import { KnowledgeEvalCase } from '@/knowledge/entities/knowledge-eval-case.entity';
import { KnowledgeEvalCaseController } from '@/knowledge/controllers/knowledge-eval-case.controller';
import { KnowledgeEvalCaseService } from '@/knowledge/services/evaluation/knowledge-eval-case.service';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([KnowledgeEvalCase]),
  ],
  providers: [
    KnowledgeEvalCaseService,
  ],
  controllers: [
    KnowledgeEvalCaseController,
  ],
  exports: [
    KnowledgeEvalCaseService,
  ],
})
export class KnowledgeEvalModule {}
