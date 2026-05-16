import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { NestFactory } from '@nestjs/core';
import { Client as PgClient } from 'pg';
import {
  DEFAULT_ELASTICSEARCH_INDEX_PREFIX,
  DEFAULT_ELASTICSEARCH_INDEX_VERSION,
  DEFAULT_ELASTICSEARCH_URL,
} from '@/common/constants';
import {
  calculateRagEvalMetrics,
  type RagEvalCaseInput,
  type RagGoldenCase,
} from '@/knowledge-content/evaluation/rag-eval.metrics';
import {
  buildRagFixtureEvalInputs,
  type RagEvalReportCase,
} from '@/knowledge-content/evaluation/rag-fixture-eval';
import { validateRagGoldenSet } from '@/knowledge-content/evaluation/rag-golden-set.validation';
import {
  buildRagEvalBlockedReportFileNames,
  buildRagEvalBlockerReport,
  buildRagEvalRuntimeMetadata,
  findRagEvalLiveEnvIssues,
  formatRagEvalError,
  parseRagEvalMode,
  redactRagEvalBlockerReason,
  requiresRagEvalModelCallApproval,
  shouldWriteRagEvalBlockerReport,
} from '@/knowledge-content/evaluation/rag-eval-report';
import { buildRagElasticOnlyQuery } from '@/knowledge-content/evaluation/rag-elastic-only-query';
import { RagLiveKeywordEvalModule } from '@/knowledge-content/evaluation/rag-live-keyword-eval.module';
import type { KnowledgeChunkIndexDocument } from '@/knowledge-content/elasticsearch/elasticsearch.types';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';
import type {
  RetrieveKnowledgeTraceItem,
  RetrievalQueryItem,
} from '@/knowledge-content/types/knowledge-content.types';

const requireFromScript = createRequire(__filename);

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function readFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function readDotEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync('.env')) return env;

  const raw = readFileSync('.env', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = stripQuotes(match[2].trim());
  }
  return env;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

const fileEnv = readDotEnv();

function envValue(key: string, fallback = ''): string {
  return String(process.env[key] ?? fileEnv[key] ?? fallback).trim();
}

function runtimeEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    ...fileEnv,
    ...process.env,
    ...overrides,
  };
}

async function resolveLiveEvalModule(liveKeywordOnly: boolean) {
  if (liveKeywordOnly) return RagLiveKeywordEvalModule;

  const { AppModule } = requireFromScript(
    '../src/app.module',
  ) as typeof import('../src/app.module');
  return AppModule;
}

async function loadGoldenSet(path: string): Promise<RagGoldenCase[]> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`golden set 必须是数组：${path}`);
  }
  return parsed as RagGoldenCase[];
}

async function assertLiveEvalPreflight(
  mode: ReturnType<typeof parseRagEvalMode>,
): Promise<void> {
  const env = runtimeEnv();
  const issues = findRagEvalLiveEnvIssues(env, mode);
  if (issues.length > 0) {
    throw new Error(
      `live eval preflight failed missing env: ${issues.join(', ')}`,
    );
  }

  const databaseUrl = envValue('DATABASE_URL');
  const client = new PgClient({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  try {
    await client.connect();
    await client.query('select 1 as ok');
  } catch (error) {
    throw new Error(
      `live eval preflight failed database host=${readDatabaseHost(databaseUrl)}: ${formatRagEvalError(error)}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

function readDatabaseHost(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return 'unknown';
  }
}

async function runElasticOnlyEval(params: {
  goldenPath: string;
  goldenSet: RagGoldenCase[];
}): Promise<void> {
  const node = envValue('ELASTICSEARCH_URL', DEFAULT_ELASTICSEARCH_URL);
  const indexPrefix = envValue(
    'ELASTICSEARCH_INDEX_PREFIX',
    DEFAULT_ELASTICSEARCH_INDEX_PREFIX,
  );
  const indexVersion =
    readArg('indexVersion') ||
    envValue('ELASTICSEARCH_INDEX_VERSION', DEFAULT_ELASTICSEARCH_INDEX_VERSION);
  const indexName = readArg('index') ?? `${indexPrefix}-knowledge-chunk-${indexVersion}`;
  const client = new ElasticsearchClient({
    node,
    maxRetries: 0,
    requestTimeout: 5000,
  });
  const caseInputs: RagEvalCaseInput[] = [];
  const caseReports: RagEvalReportCase[] = [];

  for (const item of params.goldenSet) {
    const stage1TopK = item.retrieval_config?.stage1TopK ?? 20;
    const finalTopK = item.retrieval_config?.finalTopK ?? 5;
    const stage1 = await retrieveElasticOnly(
      client,
      indexName,
      item.query,
      stage1TopK,
    ).catch((error) => {
      throw new Error(
        `ES-only 评估检索失败 node=${node} index=${indexName}: ${formatRagEvalError(error)}`,
      );
    });
    const stage2 = stage1.slice(0, finalTopK);

    caseInputs.push({
      case: item,
      stage1,
      stage2,
    });
    caseReports.push({
      id: item.id,
      query: item.query,
      expectedEvidenceSpans: item.expected_evidence_spans,
      expectedAnswerPoints: item.expected_answer_points,
      retrievalQuery: item.query,
      retrievalQueries: [
        {
          index: 0,
          query: item.query,
          keywords: [item.query],
          angle: 'original',
        },
      ],
      stage1ChunkIds: stage1.map((chunk) => chunk.id),
      stage2ChunkIds: stage2.map((chunk) => chunk.id),
      trace: [
        {
          knowledgeId: '*',
          queryIndex: 0,
          query: item.query,
          keywords: [item.query],
          angle: 'original',
          vectorBackend: 'disabled',
          keywordBackend: 'elastic',
          graphBackend: 'disabled',
          vectorResultCount: 0,
          hydeVectorResultCount: 0,
          keywordResultCount: stage1.length,
          mergedResultCount: stage1.length,
          fallbackToPg: false,
          skippedChannels: ['vector', 'hyde', 'graph'],
        },
      ],
    });
  }

  await writeReport({
    goldenPath: params.goldenPath,
    ...buildRagEvalRuntimeMetadata({
      mode: 'elastic-only',
      env: runtimeEnv({
        ELASTICSEARCH_INDEX_VERSION: indexVersion,
      }),
      elasticIndexName: indexName,
    }),
    metrics: calculateRagEvalMetrics(caseInputs),
    cases: caseReports,
  });
}

async function retrieveElasticOnly(
  client: ElasticsearchClient,
  indexName: string,
  query: string,
  size: number,
): Promise<KnowledgeChunk[]> {
  const response = await client.search<KnowledgeChunkIndexDocument>({
    index: indexName,
    size,
    query: buildRagElasticOnlyQuery(query),
    sort: [{ _score: { order: 'desc' } }, { chunk_index: { order: 'asc' } }],
  });

  return response.hits.hits
    .map((hit) => {
      const source = hit._source;
      if (!source) return null;
      return {
        id: source.id,
        document_id: source.document_id,
        knowledge_base_id: source.knowledge_base_id,
        content: source.content,
        source: source.source,
        chunk_index: Number(source.chunk_index),
        category: source.category,
        similarity: 0,
        keyword_score: hit._score ?? 0,
        retrieval_sources: ['keyword'],
        keyword_backend: 'elastic',
      } satisfies KnowledgeChunk;
    })
    .filter((chunk) => chunk !== null);
}

async function writeReport(report: {
  goldenPath: string;
  backend: Record<string, unknown>;
  models: Record<string, unknown>;
  indexVersions: Record<string, unknown>;
  metrics: ReturnType<typeof calculateRagEvalMetrics>;
  cases: RagEvalReportCase[];
}): Promise<void> {
  const fullReport = {
    generatedAt: new Date().toISOString(),
    ...report,
    cases: report.cases.map((item) => ({
      ...item,
      metrics: report.metrics.caseResults.find((metric) => metric.id === item.id),
    })),
  };

  await mkdir('reports', { recursive: true });
  const outputPath = join(
    'reports',
    `rag-eval-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`,
  );
  await writeFile(outputPath, `${JSON.stringify(fullReport, null, 2)}\n`);

  console.log(JSON.stringify(report.metrics.summary, null, 2));
  console.log(`RAG eval report written: ${outputPath}`);
}

async function runFixtureOnlyEval(params: {
  goldenPath: string;
  goldenSet: RagGoldenCase[];
  fixtureDir: string;
}): Promise<void> {
  const result = buildRagFixtureEvalInputs(params.goldenSet, {
    fixtureDir: params.fixtureDir,
  });

  await writeReport({
    goldenPath: params.goldenPath,
    ...buildRagEvalRuntimeMetadata({
      mode: 'fixture-only',
      env: runtimeEnv(),
      fixtureDir: params.fixtureDir,
    }),
    metrics: calculateRagEvalMetrics(result.caseInputs),
    cases: result.cases,
  });
}

async function main(): Promise<void> {
  const goldenPath = readArg('golden') ?? 'eval/rag-golden-set.json';
  const mode = parseRagEvalMode(readArg('mode'));
  const fixtureDir =
    readArg('fixtureDir') ?? (mode === 'fixture-only' ? 'eval/fixtures' : undefined);
  const personaFilter = readArg('personaId');
  const loadedGoldenSet = await loadGoldenSet(goldenPath);
  const goldenSetIssues = validateRagGoldenSet(loadedGoldenSet, {
    fixtureDir,
  });
  if (goldenSetIssues.length > 0) {
    throw new Error(
      `golden set 校验失败：${goldenSetIssues.join('; ')}`,
    );
  }

  const goldenSet = loadedGoldenSet.filter((item) =>
    personaFilter ? item.personaId === personaFilter : true,
  );
  if (goldenSet.length === 0) {
    throw new Error(
      personaFilter
        ? `golden set 中没有匹配 personaId=${personaFilter} 的 case`
        : 'golden set 为空，无法评估',
    );
  }

  if (readFlag('validate-only')) {
    console.log(
      JSON.stringify(
        {
          goldenPath,
          fixtureDir: fixtureDir ?? null,
          personaId: personaFilter ?? null,
          caseCount: goldenSet.length,
          status: 'ok',
        },
        null,
        2,
      ),
    );
    return;
  }

  if (mode === 'fixture-only') {
    await runFixtureOnlyEval({
      goldenPath,
      goldenSet,
      fixtureDir: fixtureDir ?? 'eval/fixtures',
    });
    return;
  }

  if (mode === 'elastic-only') {
    await runElasticOnlyEval({
      goldenPath,
      goldenSet,
    });
    return;
  }

  const liveKeywordOnly = mode === 'live-keyword-only';
  if (
    requiresRagEvalModelCallApproval(mode) &&
    !readFlag('allow-model-calls')
  ) {
    throw new Error(
      '完整 live eval 需要显式 --allow-model-calls，确认允许真实知识库候选内容调用当前模型服务；可先运行 pnpm eval:rag:live-keyword',
    );
  }

  await assertLiveEvalPreflight(mode);

  const evalModule = await resolveLiveEvalModule(liveKeywordOnly);
  const app = await NestFactory.createApplicationContext(
    evalModule,
    {
      logger: ['log', 'warn', 'error'],
    },
  );

  try {
    const knowledgeSearchService = app.get(KnowledgeSearchService);
    const caseInputs: RagEvalCaseInput[] = [];
    const caseReports: RagEvalReportCase[] = [];

    for (const item of goldenSet) {
      const result = await knowledgeSearchService.retrieveForPersonaWithStages(
        item.personaId,
        item.query,
        {
          threshold: item.retrieval_config?.threshold,
          stage1TopK: item.retrieval_config?.stage1TopK,
          finalTopK: item.retrieval_config?.finalTopK,
          rerank: liveKeywordOnly ? false : item.retrieval_config?.rerank,
          skipQueryRewrite: liveKeywordOnly,
          strategy: liveKeywordOnly
            ? {
                needRetrieval: true,
                useVector: false,
                useKeyword: true,
                useGraph: false,
                useExactPhrase: true,
                useMultiQuery: false,
                useHyDE: false,
                allowWeb: false,
                queryCount: 1,
                contextCompression: false,
                lostInMiddle: false,
                reason: 'live-keyword-only 评估：禁用 LLM/embedding/rerank',
              }
            : undefined,
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
        expectedEvidenceSpans: item.expected_evidence_spans,
        expectedAnswerPoints: item.expected_answer_points,
        retrievalQuery: result.retrievalQuery,
        retrievalQueries: result.retrievalQueries,
        rewrite: result.rewrite,
        options: result.options,
        stage1ChunkIds: result.stage1.map((chunk) => chunk.id),
        stage2ChunkIds: result.stage2.map((chunk) => chunk.id),
        trace: result.stage1Trace,
      });
    }

    await writeReport({
      goldenPath,
      ...buildRagEvalRuntimeMetadata({
        mode,
        env: runtimeEnv(),
      }),
      metrics: calculateRagEvalMetrics(caseInputs),
      cases: caseReports,
    });
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  const reason = redactRagEvalBlockerReason(
    formatRagEvalError(error),
    runtimeEnv(),
  );
  writeBlockedReport(reason).finally(() => {
    console.error(`RAG eval failed: ${reason}`);
    process.exit(1);
  });
});

async function writeBlockedReport(reason: string): Promise<void> {
  const mode = safeParseMode(readArg('mode'));
  if (!mode) return;
  if (
    !shouldWriteRagEvalBlockerReport({
      mode,
      validateOnly: readFlag('validate-only'),
    })
  ) {
    return;
  }

  await mkdir('reports', { recursive: true });
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reportBody = `${JSON.stringify(
    buildRagEvalBlockerReport({
      mode,
      env: runtimeEnv(),
      reason,
    }),
    null,
    2,
  )}\n`;
  const outputPaths = buildRagEvalBlockedReportFileNames(mode, dateStamp).map(
    (fileName) => join('reports', fileName),
  );

  await Promise.all(
    outputPaths.map((outputPath) => writeFile(outputPath, reportBody)),
  );
  console.error(`RAG eval blocker report written: ${outputPaths.join(', ')}`);
}

function safeParseMode(value: string | undefined) {
  try {
    return parseRagEvalMode(value);
  } catch {
    return null;
  }
}
