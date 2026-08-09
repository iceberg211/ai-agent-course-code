import { Module } from '@nestjs/common';
import { KnowledgeBaseModule } from './modules/knowledge-base.module';
import { KnowledgeDocumentModule } from './modules/knowledge-document.module';
import { KnowledgeRetrievalModule } from './modules/knowledge-retrieval.module';
import { KnowledgeGraphModule } from './modules/knowledge-graph.module';
import { KnowledgeEvalModule } from './modules/knowledge-eval.module';

@Module({
  imports: [
    KnowledgeBaseModule,
    KnowledgeDocumentModule,
    KnowledgeRetrievalModule,
    KnowledgeGraphModule,
    KnowledgeEvalModule,
  ],
  exports: [
    KnowledgeBaseModule,
    KnowledgeDocumentModule,
    KnowledgeRetrievalModule,
    KnowledgeGraphModule,
    KnowledgeEvalModule,
  ],
})
export class KnowledgeModule {}
