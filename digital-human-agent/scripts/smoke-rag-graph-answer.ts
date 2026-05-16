import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { RAG_ORCHESTRATOR } from '@/agent/agent.constants';
import { AgentModule } from '@/agent/agent.module';
import { LangGraphRagOrchestratorService } from '@/agent/orchestrators/langgraph-rag-orchestrator.service';
import { AnswerGenerationService } from '@/agent/services/answer-generation.service';
import type {
  RagCitation,
  RagOrchestrator,
  RetrievalStrategy,
} from '@/agent/types/rag-workflow.types';
import { ConversationModule } from '@/conversation/conversation.module';
import { ConversationService } from '@/conversation/conversation.service';
import { DatabaseModule } from '@/database/database.module';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

interface CandidatePersonaRow {
  persona_id: string;
}

interface CandidateGraphQuestionRow {
  source_name: string;
  target_name: string;
  relation_label: string | null;
}

const DEFAULT_SMOKE_TIMEOUT_MS = 45_000;

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function readPositiveIntArg(name: string, fallback: number): number {
  const value = Number(readArg(name));
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.trunc(value);
}

function readFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function readNonEmptyArg(name: string): string | undefined {
  const value = readArg(name)?.trim();
  return value ? value : undefined;
}

function prepareSmokeRuntime(): void {
  process.env.ENABLE_GRAPH_RETRIEVAL = 'true';
  process.env.RAG_SEMANTIC_CACHE_ENABLED = 'false';
  process.env.LANGSMITH_TRACING = 'false';
  process.env.LANGCHAIN_TRACING_V2 = 'false';

  const modelName = readNonEmptyArg('model-name');
  if (modelName) {
    process.env.MODEL_NAME = modelName;
  }

  const rerankerProvider = readNonEmptyArg('reranker-provider');
  if (rerankerProvider) {
    process.env.RERANKER_PROVIDER = rerankerProvider;
  }

  const rerankerModel = readNonEmptyArg('reranker-model');
  if (rerankerModel) {
    process.env.RERANKER_MODEL = rerankerModel;
  }
}

function getRerankerRuntimeInfo() {
  return {
    llmModel: process.env.MODEL_NAME ?? null,
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? null,
    apiKeySource: process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : 'missing',
    rerankerProvider: process.env.RERANKER_PROVIDER ?? 'llm-json',
    rerankerModel:
      process.env.RERANKER_MODEL ??
      process.env.RERANKER_MODEL_NAME ??
      process.env.MODEL_NAME ??
      null,
  };
}

function createSmokeAbortController(timeoutMs: number): {
  controller: AbortController;
  clear: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new Error(`Graph answer smoke 超时：${timeoutMs}ms`),
    );
  }, timeoutMs);

  return {
    controller,
    clear: () => clearTimeout(timeout),
  };
}

function assertRealContentModelCallAcknowledged(): void {
  if (readFlag('i-understand-real-content-model-call')) {
    return;
  }

  throw new Error(
    [
      '真实 Graph answer smoke 会把当前知识库检索内容发送到配置的模型服务。',
      '确认已了解该风险后，请追加参数：-- --i-understand-real-content-model-call',
    ].join(' '),
  );
}

async function findCandidatePersonaId(
  dataSource: DataSource,
): Promise<string | null> {
  const rows = (await dataSource.query(`
    SELECT
      pk.persona_id,
      COUNT(*) FILTER (WHERE e.relation_type <> 'HAS_CHUNK') AS relation_count,
      COUNT(*) AS edge_count
    FROM persona_knowledge_base pk
    JOIN knowledge_document d
      ON d.knowledge_base_id = pk.knowledge_base_id
    JOIN rag_graph_index_status s
      ON s.document_id = d.id
    JOIN rag_graph_edge e
      ON e.document_id = d.id
    WHERE d.status = 'completed'
      AND s.status = 'indexed'
      AND e.chunk_id IS NOT NULL
    GROUP BY pk.persona_id
    ORDER BY relation_count DESC, edge_count DESC, pk.persona_id ASC
    LIMIT 1
  `)) as CandidatePersonaRow[];

  return rows[0]?.persona_id ?? null;
}

async function buildCandidateGraphQuestion(
  dataSource: DataSource,
  personaId: string,
): Promise<string | null> {
  const rows = (await dataSource.query(
    `
      SELECT
        sn.display_name AS source_name,
        tn.display_name AS target_name,
        e.relation_label
      FROM persona_knowledge_base pk
      JOIN knowledge_document d
        ON d.knowledge_base_id = pk.knowledge_base_id
      JOIN rag_graph_index_status s
        ON s.document_id = d.id
      JOIN rag_graph_edge e
        ON e.document_id = d.id
      JOIN rag_graph_node sn
        ON sn.id = e.source_node_id
      JOIN rag_graph_node tn
        ON tn.id = e.target_node_id
      WHERE pk.persona_id = $1
        AND d.status = 'completed'
        AND s.status = 'indexed'
        AND e.chunk_id IS NOT NULL
      ORDER BY
        CASE WHEN e.relation_type = 'HAS_CHUNK' THEN 1 ELSE 0 END ASC,
        e.confidence DESC,
        e.created_at DESC
      LIMIT 1
    `,
    [personaId],
  )) as CandidateGraphQuestionRow[];

  const row = rows[0];
  if (!row?.source_name || !row.target_name) return null;
  const relation = row.relation_label?.trim();
  return relation
    ? `${row.source_name}和${row.target_name}的${relation}关系是什么？`
    : `${row.source_name}和${row.target_name}是什么关系？`;
}

function countGraphEvidence(citations: RagCitation[]): number {
  return citations
    .filter((citation) => citation.kind === 'knowledge')
    .reduce((count, citation) => {
      return count + (citation.graph_evidence?.length ?? 0);
    }, 0);
}

function compactCitations(citations: RagCitation[]) {
  return citations.map((citation) => {
    if (citation.kind === 'web') {
      return {
        kind: 'web',
        title: citation.title,
        url: citation.url,
      };
    }

    return {
      kind: 'knowledge',
      id: citation.id,
      documentId: citation.document_id,
      source: citation.source,
      chunkIndex: citation.chunk_index,
      retrievalSources: citation.retrieval_sources,
      graphEvidence: citation.graph_evidence?.slice(0, 3),
    };
  });
}

function buildSanitizedFixtureStrategy(): RetrievalStrategy {
  return {
    needRetrieval: true,
    useVector: false,
    useKeyword: false,
    useGraph: true,
    useExactPhrase: true,
    useMultiQuery: false,
    useHyDE: false,
    allowWeb: false,
    queryCount: 1,
    chunkContextWindow: 0,
    parentContext: false,
    parentContextMaxChars: 2000,
    contextCompression: false,
    lostInMiddle: false,
    graphMode: 'path',
    graphMaxHops: 2,
    reason: '脱敏 fixture：验证 Graph answer 主路径',
  };
}

function buildSanitizedFixtureChunk(): KnowledgeChunk {
  return {
    id: 'fixture-graph-chunk-1',
    document_id: 'fixture-graph-document-1',
    knowledge_base_id: 'fixture-knowledge-base-1',
    content:
      '演示提纲说明：系统定位包含“智能检索”和“证据引用”两个子主题，回答时应说明两者是层级包含关系。',
    source: 'sanitized-graph-fixture.md',
    chunk_index: 0,
    category: '脱敏验证',
    similarity: 1,
    graph_score: 1,
    hybrid_score: 1,
    retrieval_sources: ['graph'],
    graph_evidence: [
      {
        source: '系统定位',
        target: '智能检索',
        relationType: 'HAS_SUBTOPIC',
        relationLabel: '包含子主题',
        evidenceText: '系统定位包含“智能检索”和“证据引用”两个子主题。',
        confidence: 0.99,
      },
      {
        source: '系统定位',
        target: '证据引用',
        relationType: 'HAS_SUBTOPIC',
        relationLabel: '包含子主题',
        evidenceText: '系统定位包含“智能检索”和“证据引用”两个子主题。',
        confidence: 0.99,
      },
    ],
  };
}

async function runSanitizedFixtureSmoke(): Promise<void> {
  prepareSmokeRuntime();

  const strategy = buildSanitizedFixtureStrategy();
  const chunk = buildSanitizedFixtureChunk();
  const query = '系统定位和智能检索是什么关系？';
  const timeoutMs = readPositiveIntArg(
    'timeout-ms',
    DEFAULT_SMOKE_TIMEOUT_MS,
  );
  const smokeAbort = createSmokeAbortController(timeoutMs);
  const answerGenerationService = new AnswerGenerationService();
  const orchestrator = new LangGraphRagOrchestratorService(
    {
      retrieveForPersona: async () => [chunk],
    } as never,
    {
      findOne: async () => ({
        id: 'fixture-persona-graph',
        name: '脱敏验证助手',
        description: '用于验证 Graph RAG 回答主路径的合成角色',
        speakingStyle: '清楚、简洁',
        expertise: ['RAG 验证'],
        voiceId: null,
        avatarId: null,
        systemPromptExtra: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
    } as never,
    {
      getCompletedMessages: async () => [],
    } as never,
    answerGenerationService,
    {
      routeQuestion: async () => ({
        strategy: 'simple',
        reason: '脱敏 fixture 关系类问题',
      }),
    } as never,
    {
      plan: async () => strategy,
    } as never,
    {
      planSubQuestions: async () => ({
        subQuestions: [query],
        reason: 'simple 路径不会使用该结果',
      }),
    } as never,
    {
      evaluate: async () => ({
        enough: true,
        missingFacts: [],
        reason: '脱敏图谱证据足够回答',
        webQuery: '',
      }),
    } as never,
    {
      isEnabled: () => false,
      search: async () => [],
    } as never,
  );
  const tokens: string[] = [];
  let latestCitations: RagCitation[] = [];
  const resultPromise = orchestrator.run({
    conversationId: 'fixture-conversation-graph-answer',
    personaId: 'fixture-persona-graph',
    question: query,
    turnId: `fixture-graph-answer-smoke-${Date.now()}`,
    maxHops: 1,
    signal: smokeAbort.controller.signal,
    onToken: (token) => tokens.push(token),
    onCitations: (citations) => {
      latestCitations = citations;
    },
  });
  const result = await resultPromise.finally(smokeAbort.clear);
  const citations =
    result.citations.length > 0 ? result.citations : latestCitations;
  const graphEvidenceCount = countGraphEvidence(citations);

  if (!result.state.retrievalStrategy.useGraph || graphEvidenceCount === 0) {
    throw new Error(
      `脱敏 Graph answer smoke 未证明图谱参与：useGraph=${result.state.retrievalStrategy.useGraph} graphEvidenceCount=${graphEvidenceCount}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        action: 'rag-graph-answer-smoke',
        dataMode: 'sanitized-fixture',
        modelCalls: true,
        langsmithTracing: false,
        timeoutMs,
        ...getRerankerRuntimeInfo(),
        blockedReason: null,
        personaId: 'fixture-persona-graph',
        query,
        strategy: result.state.strategy,
        routeReason: result.state.routeReason,
        stopReason: result.state.stopReason,
        answerPreview: result.answerText.slice(0, 360),
        tokenCount: tokens.length,
        citationCount: citations.length,
        graphEvidenceCount,
        retrievalStrategy: result.state.retrievalStrategy,
        retrievalHistory: result.state.retrievalHistory,
        citations: compactCitations(citations),
      },
      null,
      2,
    ),
  );
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    ConversationModule,
    AgentModule,
  ],
})
class RagGraphAnswerSmokeModule {}

async function main(): Promise<void> {
  if (readFlag('fixture-sanitized')) {
    await runSanitizedFixtureSmoke();
    return;
  }

  assertRealContentModelCallAcknowledged();

  prepareSmokeRuntime();

  const app = await NestFactory.createApplicationContext(
    RagGraphAnswerSmokeModule,
    { logger: ['warn', 'error'] },
  );

  try {
    const dataSource = app.get(DataSource);
    const conversationService = app.get(ConversationService);
    const orchestrator = app.get<RagOrchestrator>(RAG_ORCHESTRATOR, {
      strict: false,
    });
    const personaId =
      readArg('personaId') ?? (await findCandidatePersonaId(dataSource));
    if (!personaId) {
      throw new Error(
        '找不到已挂载知识库且 graph_index_status=indexed 的 persona，请先完成 migration 和 graph:backfill，或传入 --personaId=...',
      );
    }
    const query =
      readArg('query') ??
      (await buildCandidateGraphQuestion(dataSource, personaId)) ??
      '甲方和乙方是什么关系？';
    const conversation = await conversationService.createConversation(personaId);
    const turnId = `rag-graph-answer-smoke-${Date.now()}`;
    const timeoutMs = readPositiveIntArg(
      'timeout-ms',
      DEFAULT_SMOKE_TIMEOUT_MS,
    );
    const smokeAbort = createSmokeAbortController(timeoutMs);
    const tokens: string[] = [];
    let latestCitations: RagCitation[] = [];

    const resultPromise = orchestrator.run({
      conversationId: conversation.id,
      personaId,
      question: query,
      turnId,
      maxHops: readPositiveIntArg('maxHops', 1),
      signal: smokeAbort.controller.signal,
      onToken: (token) => tokens.push(token),
      onCitations: (citations) => {
        latestCitations = citations;
      },
    });
    const result = await resultPromise.finally(smokeAbort.clear);
    const citations =
      result.citations.length > 0 ? result.citations : latestCitations;
    const graphEvidenceCount = countGraphEvidence(citations);
    if (!result.state.retrievalStrategy.useGraph || graphEvidenceCount === 0) {
      throw new Error(
        `Graph answer smoke 未证明图谱参与：useGraph=${result.state.retrievalStrategy.useGraph} graphEvidenceCount=${graphEvidenceCount}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          status: 'ok',
          action: 'rag-graph-answer-smoke',
          modelCalls: true,
          langsmithTracing: false,
          timeoutMs,
          ...getRerankerRuntimeInfo(),
          blockedReason: null,
          personaId,
          conversationId: conversation.id,
          turnId,
          query,
          strategy: result.state.strategy,
          routeReason: result.state.routeReason,
          stopReason: result.state.stopReason,
          answerPreview: result.answerText.slice(0, 360),
          tokenCount: tokens.length,
          citationCount: citations.length,
          graphEvidenceCount,
          retrievalStrategy: result.state.retrievalStrategy,
          retrievalHistory: result.state.retrievalHistory,
          citations: compactCitations(citations),
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
  const blockedReason = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify(
      {
        status: 'blocked',
        action: 'rag-graph-answer-smoke',
        modelCalls: true,
        langsmithTracing: false,
        timeoutMs: readPositiveIntArg('timeout-ms', DEFAULT_SMOKE_TIMEOUT_MS),
        ...getRerankerRuntimeInfo(),
        blockedReason,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
