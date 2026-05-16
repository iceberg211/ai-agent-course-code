import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';

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
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function main(): Promise<void> {
  process.env.NEO4J_GRAPH_ENABLED = 'true';
  process.env.HYBRID_KEYWORD_BACKEND =
    readArg('keyword-backend') ?? process.env.HYBRID_KEYWORD_BACKEND ?? 'elastic';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const runtime = app.get(KnowledgeContentRuntimeService);
    const searchService = app.get(KnowledgeSearchService);
    const personaId = readArg('personaId') ?? (await findMountedPersonaId(runtime));
    if (!personaId) {
      throw new Error('未找到已挂载知识库的 persona，请传入 --personaId=...');
    }

    const query =
      readArg('query') ?? '这个知识库里有哪些关键实体、关系和对应证据？';

    const result = await searchService.retrieveForPersonaWithStages(
      personaId,
      query,
      {
        rerank: false,
        skipQueryRewrite: true,
        stage1TopK: 12,
        finalTopK: 6,
        strategy: {
          needRetrieval: true,
          useVector: true,
          useKeyword: true,
          useGraph: true,
          useExactPhrase: true,
          useMultiQuery: false,
          useHyDE: false,
          allowWeb: false,
          graphMode: 'neighbors',
          graphMaxHops: 1,
          reason: 'Agentic RAG smoke 强制验证向量、关键词和 Neo4j 三路检索',
        },
      },
    );

    const summary = summarize(result.stage1Trace);
    const graphEvidenceCount = result.stage2.reduce(
      (count, chunk) => count + (chunk.graph_evidence?.length ?? 0),
      0,
    );
    const strict = !process.argv.includes('--allow-partial');
    const passed =
      summary.vectorResultCount > 0 &&
      summary.keywordResultCount > 0 &&
      summary.graphResultCount > 0;

    console.log(
      JSON.stringify(
        {
          status: passed ? 'ok' : strict ? 'failed' : 'partial',
          personaId,
          query,
          keywordBackend: summary.keywordBackend,
          vectorResultCount: summary.vectorResultCount,
          keywordResultCount: summary.keywordResultCount,
          graphResultCount: summary.graphResultCount,
          stage1Count: result.stage1.length,
          stage2Count: result.stage2.length,
          graphEvidenceCount,
          trace: result.stage1Trace,
        },
        null,
        2,
      ),
    );

    if (strict && !passed) {
      throw new Error(
        '三路检索未全部命中；可先检查 Neo4j/ES 是否启动并已 backfill，或用 --allow-partial 只观察输出',
      );
    }
  } finally {
    await app.close();
  }
}

async function findMountedPersonaId(
  runtime: KnowledgeContentRuntimeService,
): Promise<string | null> {
  const { data, error } = await runtime.supabase
    .from('persona_knowledge_base')
    .select('persona_id')
    .limit(1);
  if (error) {
    throw new Error(error.message);
  }
  const row = data?.[0] as { persona_id?: string } | undefined;
  return row?.persona_id ?? null;
}

function summarize(
  trace: Array<{
    vectorResultCount: number;
    keywordResultCount: number;
    graphResultCount?: number;
    keywordBackend: string;
  }>,
): {
  vectorResultCount: number;
  keywordResultCount: number;
  graphResultCount: number;
  keywordBackend: string;
} {
  return trace.reduce<{
    vectorResultCount: number;
    keywordResultCount: number;
    graphResultCount: number;
    keywordBackend: string;
  }>(
    (current, item) => ({
      vectorResultCount: current.vectorResultCount + item.vectorResultCount,
      keywordResultCount: current.keywordResultCount + item.keywordResultCount,
      graphResultCount: current.graphResultCount + (item.graphResultCount ?? 0),
      keywordBackend:
        current.keywordBackend === 'disabled'
          ? item.keywordBackend
          : current.keywordBackend,
    }),
    {
      vectorResultCount: 0,
      keywordResultCount: 0,
      graphResultCount: 0,
      keywordBackend: 'disabled',
    },
  );
}

main().catch((error) => {
  console.error(
    `Agentic RAG smoke 失败：${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
