import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { formatElasticsearchError } from '@/knowledge/elasticsearch/elasticsearch-error-format';
import { ElasticsearchIndexService } from '@/knowledge/elasticsearch/elasticsearch-index.service';
import { ElasticsearchScriptModule } from './elasticsearch-script.module';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    ElasticsearchScriptModule,
    {
      logger: ['log', 'warn', 'error'],
    },
  );

  try {
    const indexService = app.get(ElasticsearchIndexService);
    if (!indexService.isEnabled()) {
      throw new Error('ES 未启用，无法初始化索引');
    }

    await indexService.ensureKnowledgeChunkIndex();
    console.log(
      JSON.stringify(
        {
          action: 'ensure-elasticsearch-index',
          index: indexService.getKnowledgeChunkIndexName(),
          readAlias: indexService.getKnowledgeChunkReadAlias(),
          writeAlias: indexService.getKnowledgeChunkWriteAlias(),
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(`ES 索引初始化失败：${formatElasticsearchError(error)}`);
  process.exit(1);
});
