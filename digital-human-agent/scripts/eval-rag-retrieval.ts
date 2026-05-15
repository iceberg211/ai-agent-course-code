import 'reflect-metadata';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { DEFAULT_ELASTICSEARCH_INDEX_VERSION } from '@/common/constants';
import {
  calculateRagEvalMetrics,
  type RagEvalCaseInput,
  type RagGoldenCase,
} from '@/knowledge-content/evaluation/rag-eval.metrics';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import type {
  RetrieveKnowledgeTraceItem,
  RetrievalQueryItem,
} from '@/knowledge-content/types/knowledge-content.types';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function loadGoldenSet(path: string): Promise<RagGoldenCase[]> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`golden set 必须是数组：${path}`);
  }
  return parsed as RagGoldenCase[];
}

async function main(): Promise<void> {
  const goldenPath = readArg('golden') ?? 'eval/rag-golden-set.json';
  const personaFilter = readArg('personaId');
  const goldenSet = (await loadGoldenSet(goldenPath)).filter((item) =>
    personaFilter ? item.personaId === personaFilter : true,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const knowledgeSearchService = app.get(KnowledgeSearchService);
    const caseInputs: RagEvalCaseInput[] = [];
    const caseReports: Array<{
      id: string;
      query: string;
      retrievalQuery: string;
      retrievalQueries: RetrievalQueryItem[];
      stage1ChunkIds: string[];
      stage2ChunkIds: string[];
      trace: RetrieveKnowledgeTraceItem[];
    }> = [];

    for (const item of goldenSet) {
      const result = await knowledgeSearchService.retrieveForPersonaWithStages(
        item.personaId,
        item.query,
        {
          threshold: item.retrieval_config?.threshold,
          stage1TopK: item.retrieval_config?.stage1TopK,
          finalTopK: item.retrieval_config?.finalTopK,
          rerank: item.retrieval_config?.rerank,
        },
      );

      caseInputs.push({
        case: item,
        stage1: result.stage1,
        stage2: result.stage2,
      });
      caseReports.push({
        id: item.id,
        query: item.query,
        retrievalQuery: result.retrievalQuery,
        retrievalQueries: result.retrievalQueries,
        stage1ChunkIds: result.stage1.map((chunk) => chunk.id),
        stage2ChunkIds: result.stage2.map((chunk) => chunk.id),
        trace: result.stage1Trace,
      });
    }

    const metrics = calculateRagEvalMetrics(caseInputs);
    const report = {
      generatedAt: new Date().toISOString(),
      goldenPath,
      backend: {
        vector: 'pgvector',
        keyword: process.env.HYBRID_KEYWORD_BACKEND ?? 'pg',
        elasticsearchEnabled: process.env.ELASTICSEARCH_ENABLED ?? 'false',
      },
      models: {
        llm: process.env.MODEL_NAME ?? null,
        embeddings: process.env.EMBEDDINGS_MODEL_NAME ?? 'text-embedding-v3',
        queryRewrite:
          process.env.QUERY_REWRITE_MODEL_NAME ?? process.env.MODEL_NAME ?? null,
        rerankerProvider: process.env.RERANKER_PROVIDER ?? 'llm-json',
        rerankerModel:
          process.env.RERANKER_MODEL ??
          process.env.RERANKER_MODEL_NAME ??
          process.env.MODEL_NAME ??
          null,
      },
      indexVersions: {
        elasticsearch:
          process.env.ELASTICSEARCH_INDEX_VERSION ??
          DEFAULT_ELASTICSEARCH_INDEX_VERSION,
        graph: null,
      },
      metrics,
      cases: caseReports.map((item) => ({
        ...item,
        metrics: metrics.caseResults.find((metric) => metric.id === item.id),
      })),
    };

    await mkdir('reports', { recursive: true });
    const outputPath = join(
      'reports',
      `rag-eval-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`,
    );
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

    console.log(JSON.stringify(report.metrics.summary, null, 2));
    console.log(`RAG eval report written: ${outputPath}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(
    `RAG eval failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
