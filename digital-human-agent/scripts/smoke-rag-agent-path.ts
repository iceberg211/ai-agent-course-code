import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { LangGraphRagOrchestratorService } from '@/agent/orchestrators/langgraph-rag-orchestrator.service';
import { RagRuntimeService } from '@/knowledge/services/manage/rag-runtime.service';

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
  return (
    process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ??
    null
  );
}

async function main(): Promise<void> {
  process.env.NEO4J_GRAPH_ENABLED = 'true';
  process.env.NEO4J_URL ??= 'bolt://localhost:7687';
  process.env.NEO4J_USERNAME ??= 'neo4j';
  process.env.NEO4J_PASSWORD ??= '12345678';
  process.env.NEO4J_DATABASE ??= 'neo4j';
  process.env.HYBRID_KEYWORD_BACKEND =
    readArg('keyword-backend') ??
    process.env.HYBRID_KEYWORD_BACKEND ??
    'elastic';

  const { AppModule } =
    require('@/app.module') as typeof import('@/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const runtime = app.get(RagRuntimeService);
    const orchestrator = app.get(LangGraphRagOrchestratorService);
    const personaId =
      readArg('personaId') ?? (await findMountedPersonaId(runtime));
    if (!personaId) {
      throw new Error('未找到已挂载知识库的 persona，请传入 --personaId=...');
    }

    const query =
      readArg('query') ?? '系统是否允许把甲方上传的合同直接用于公开训练？';
    const strict = !process.argv.includes('--allow-partial');
    const pushedCitations: unknown[][] = [];
    const result = await orchestrator.run({
      // conversation_id 是 uuid 列，必须用合法 uuid（smoke-conv- 前缀会被 pg 拒绝）
      conversationId: randomUUID(),
      personaId,
      question: query,
      turnId: randomUUID(),
      signal: new AbortController().signal,
      onToken: () => undefined,
      onCitations: (citations) => pushedCitations.push(citations),
      maxHops: 1,
      profileId: 'search_debug',
      startedAt: Date.now(),
    });

    const summary = summarize(result.state.retrievalTrace);
    const graphEvidenceCount = result.state.topDocuments.reduce(
      (count, chunk) => count + (chunk.graph_evidence?.length ?? 0),
      0,
    );
    const passed =
      summary.vectorResultCount > 0 &&
      summary.keywordResultCount > 0 &&
      summary.graphResultCount > 0 &&
      result.state.topDocuments.length > 0;

    console.log(
      JSON.stringify(
        {
          status: passed ? 'ok' : strict ? 'failed' : 'partial',
          mode: 'agent-path',
          personaId,
          query,
          finalRetrievalStrategy: result.state.retrievalStrategy,
          stopReason: result.state.stopReason,
          answerText: result.answerText,
          vectorResultCount: summary.vectorResultCount,
          keywordResultCount: summary.keywordResultCount,
          graphResultCount: summary.graphResultCount,
          topDocumentCount: result.state.topDocuments.length,
          graphEvidenceCount,
          citationPushCount: pushedCitations.length,
          trace: result.state.retrievalTrace,
        },
        null,
        2,
      ),
    );

    if (strict && !passed) {
      throw new Error(
        'Agent path smoke 未同时验证通过三路召回与最终本地证据装载，可改用 --allow-partial 先观察输出',
      );
    }
  } finally {
    await app.close();
  }
}

async function findMountedPersonaId(
  runtime: RagRuntimeService,
): Promise<string | null> {
  const { data: mountedRows, error: mountedError } = await runtime.supabase
    .from('persona_knowledge_base')
    .select('persona_id, knowledge_base_id')
    .limit(50);
  if (mountedError) {
    throw new Error(mountedError.message);
  }

  const mounted = (mountedRows ?? []) as Array<{
    persona_id?: string;
    knowledge_base_id?: string;
  }>;
  if (mounted.length === 0) return null;

  const knowledgeIds = Array.from(
    new Set(mounted.map((row) => row.knowledge_base_id).filter(Boolean)),
  ) as string[];
  const { data: documents, error: documentError } = await runtime.supabase
    .from('knowledge_document')
    .select('id, knowledge_base_id')
    .in('knowledge_base_id', knowledgeIds);
  if (documentError) {
    throw new Error(documentError.message);
  }

  const documentRows = (documents ?? []) as Array<{
    id?: string;
    knowledge_base_id?: string;
  }>;
  const documentToKnowledge = new Map<string, string>();
  for (const document of documentRows) {
    if (document.id && document.knowledge_base_id) {
      documentToKnowledge.set(document.id, document.knowledge_base_id);
    }
  }

  const documentIds = Array.from(documentToKnowledge.keys());
  if (documentIds.length === 0) {
    return mounted[0]?.persona_id ?? null;
  }

  const { data: chunks, error: chunkError } = await runtime.supabase
    .from('knowledge_chunk')
    .select('document_id')
    .eq('enabled', true)
    .in('document_id', documentIds);
  if (chunkError) {
    throw new Error(chunkError.message);
  }

  const chunkCountByKnowledge = new Map<string, number>();
  for (const chunk of (chunks ?? []) as Array<{ document_id?: string }>) {
    const knowledgeId = chunk.document_id
      ? documentToKnowledge.get(chunk.document_id)
      : undefined;
    if (!knowledgeId) continue;
    chunkCountByKnowledge.set(
      knowledgeId,
      (chunkCountByKnowledge.get(knowledgeId) ?? 0) + 1,
    );
  }

  let selectedPersonaId = mounted[0]?.persona_id ?? null;
  let selectedChunkCount = -1;
  for (const row of mounted) {
    if (!row.persona_id || !row.knowledge_base_id) continue;
    const chunkCount = chunkCountByKnowledge.get(row.knowledge_base_id) ?? 0;
    if (chunkCount > selectedChunkCount) {
      selectedPersonaId = row.persona_id;
      selectedChunkCount = chunkCount;
    }
  }

  return selectedPersonaId;
}

function summarize(
  trace: Array<{
    vectorResultCount: number;
    keywordResultCount: number;
    graphResultCount?: number;
  }>,
): {
  vectorResultCount: number;
  keywordResultCount: number;
  graphResultCount: number;
} {
  return trace.reduce<{
    vectorResultCount: number;
    keywordResultCount: number;
    graphResultCount: number;
  }>(
    (current, item) => ({
      vectorResultCount: current.vectorResultCount + item.vectorResultCount,
      keywordResultCount: current.keywordResultCount + item.keywordResultCount,
      graphResultCount: current.graphResultCount + (item.graphResultCount ?? 0),
    }),
    {
      vectorResultCount: 0,
      keywordResultCount: 0,
      graphResultCount: 0,
    },
  );
}

main().catch((error) => {
  console.error(
    `Agent path smoke 失败：${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
