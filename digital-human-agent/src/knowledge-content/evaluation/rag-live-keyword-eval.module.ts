import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/database/database.module';
import { KnowledgeContentModule } from '@/knowledge-content/knowledge-content.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    KnowledgeContentModule,
  ],
})
export class RagLiveKeywordEvalModule {}
