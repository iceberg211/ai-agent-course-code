import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { KnowledgeElasticsearchBackfillService } from '@/knowledge-content/backfill/knowledge-elasticsearch-backfill.service';

function resolvePageSize(): number {
  const rawValue = process.argv.find((arg) => arg.startsWith('--page-size='));
  if (!rawValue) {
    return 200;
  }

  const parsed = Number(rawValue.split('=')[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`非法的 page-size：${rawValue}`);
  }

  return Math.floor(parsed);
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const pageSize = resolvePageSize();
    const backfillService = app.get(KnowledgeElasticsearchBackfillService);
    const summary = await backfillService.backfillAll(pageSize);

    console.log(
      `ES 回填完成：pageCount=${summary.pageCount} chunkCount=${summary.chunkCount}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(
    `ES 回填失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
