import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { elasticsearchProvider } from '@/knowledge-content/elasticsearch/elasticsearch.provider';
import { ElasticsearchIndexService } from '@/knowledge-content/elasticsearch/elasticsearch-index.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [elasticsearchProvider, ElasticsearchIndexService],
  exports: [ElasticsearchIndexService],
})
export class ElasticsearchScriptModule {}
