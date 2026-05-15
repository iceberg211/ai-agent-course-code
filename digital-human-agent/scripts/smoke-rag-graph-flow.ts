import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { createRetrievalStrategyNode } from '@/agent/langgraph/nodes/retrieval-strategy.node';
import { createRetrieveEvidenceNode } from '@/agent/langgraph/nodes/retrieve.node';
import { buildInitialRagGraphState } from '@/agent/langgraph/rag.state';
import { normalizeRetrievalStrategy } from '@/agent/retrieval-strategy.utils';
import { RetrievalStrategyService } from '@/agent/services/retrieval-strategy.service';
import type {
  RagCitation,
  RetrievalStrategy,
} from '@/agent/types/rag-workflow.types';
import { RagLiveKeywordEvalModule } from '@/knowledge-content/evaluation/rag-live-keyword-eval.module';
import { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';

interface CandidatePersonaRow {
  persona_id: string;
}

interface CandidateGraphQuestionRow {
  source_name: string;
  target_name: string;
  relation_label: string | null;
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function readPositiveIntArg(name: string, fallback: number): number {
  const value = Number(readArg(name));
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.trunc(value);
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

function createNoModelRetrievalStrategyService(): RetrievalStrategyService {
  const service = new RetrievalStrategyService();
  Object.assign(service as unknown as { llm: unknown }, {
    llm: {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('Graph flow smoke 禁止模型策略规划');
        },
      }),
    },
  });
  return service;
}

function toModelSafeGraphStrategy(
  plannedStrategy: RetrievalStrategy,
): RetrievalStrategy {
  return normalizeRetrievalStrategy({
    ...plannedStrategy,
    useVector: false,
    useKeyword: false,
    useGraph: true,
    useExactPhrase: true,
    useMultiQuery: false,
    useHyDE: false,
    allowWeb: false,
    queryCount: 1,
    contextCompression: false,
    lostInMiddle: false,
    graphMode: plannedStrategy.graphMode ?? 'path',
    graphMaxHops:
      plannedStrategy.graphMaxHops ?? readPositiveIntArg('graphMaxHops', 2),
    reason: `${plannedStrategy.reason}；Graph flow smoke 强制仅图谱检索`,
  });
}

function compactStrategy(strategy: RetrievalStrategy) {
  return {
    needRetrieval: strategy.needRetrieval,
    useVector: strategy.useVector,
    useKeyword: strategy.useKeyword,
    useGraph: strategy.useGraph,
    useExactPhrase: strategy.useExactPhrase,
    useMultiQuery: strategy.useMultiQuery,
    useHyDE: strategy.useHyDE,
    allowWeb: strategy.allowWeb,
    graphMode: strategy.graphMode,
    graphMaxHops: strategy.graphMaxHops,
    reason: strategy.reason,
  };
}

async function main(): Promise<void> {
  process.env.ENABLE_GRAPH_RETRIEVAL = 'true';
  process.env.RAG_SEMANTIC_CACHE_ENABLED = 'false';

  const requestedQuery = readArg('query');
  const finalTopK = readPositiveIntArg('topK', 3);
  const app = await NestFactory.createApplicationContext(
    RagLiveKeywordEvalModule,
    { logger: ['warn', 'error'] },
  );

  try {
    const dataSource = app.get(DataSource);
    const personaId =
      readArg('personaId') ?? (await findCandidatePersonaId(dataSource));
    if (!personaId) {
      throw new Error(
        '找不到已挂载知识库且 graph_index_status=indexed 的 persona，请先完成 migration 和 graph:backfill，或传入 --personaId=...',
      );
    }
    const query =
      requestedQuery ??
      (await buildCandidateGraphQuestion(dataSource, personaId)) ??
      '甲方和乙方是什么关系？';

    let latestCitations: RagCitation[] = [];
    const workflowInput = {
      conversationId: 'rag-graph-flow-smoke',
      personaId,
      question: query,
      turnId: `rag-graph-flow-smoke-${Date.now()}`,
      signal: new AbortController().signal,
      onToken: () => undefined,
      onCitations: (citations: RagCitation[]) => {
        latestCitations = citations;
      },
    };
    const baseState = {
      ...buildInitialRagGraphState(workflowInput),
      strategy: 'simple' as const,
      routeReason: 'Graph flow smoke 直接验证检索策略到检索节点',
    };

    const strategyNode = createRetrievalStrategyNode(
      createNoModelRetrievalStrategyService(),
    );
    const strategyCommand = await strategyNode(baseState, {
      configurable: { workflowInput },
      context: { workflowInput },
    } as never);
    const plannedStrategy = strategyCommand.update?.retrievalStrategy;
    if (!plannedStrategy?.useGraph) {
      throw new Error(
        `策略节点没有启用 Graph：${JSON.stringify(plannedStrategy ?? null)}`,
      );
    }

    const effectiveStrategy = toModelSafeGraphStrategy(plannedStrategy);
    const knowledgeSearchService = app.get(KnowledgeSearchService);
    const retrieveOnlyKnowledgeSearchService = {
      retrieveForPersona: (
        nextPersonaId: string,
        nextQuery: string,
        options: Parameters<KnowledgeSearchService['retrieveForPersona']>[2],
      ) =>
        knowledgeSearchService.retrieveForPersona(nextPersonaId, nextQuery, {
          ...options,
          strategy: effectiveStrategy,
          finalTopK,
          rerank: false,
          skipQueryRewrite: true,
        }),
    };
    const retrieveNode = createRetrieveEvidenceNode(
      retrieveOnlyKnowledgeSearchService as KnowledgeSearchService,
    );
    const retrieveState = {
      ...baseState,
      ...strategyCommand.update,
      retrievalStrategy: effectiveStrategy,
      retrievalStrategyReason: effectiveStrategy.reason,
    };
    const update = await retrieveNode(retrieveState, {
      configurable: { workflowInput },
      context: { workflowInput },
    } as never);
    const evidenceChunks = update.evidenceChunks ?? [];
    const graphChunks = evidenceChunks.filter((chunk) =>
      chunk.retrieval_sources?.includes('graph'),
    );

    if (graphChunks.length === 0) {
      throw new Error(
        `Graph flow smoke 未召回图谱证据：personaId=${personaId} query=${query}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          status: 'ok',
          action: 'rag-graph-flow-smoke',
          modelCalls: false,
          plannerMode: 'fallback-no-model',
          personaId,
          query,
          graphEnabled: process.env.ENABLE_GRAPH_RETRIEVAL === 'true',
          strategyGoto: strategyCommand.goto,
          plannedStrategy: compactStrategy(plannedStrategy),
          effectiveRetrievalStrategy: compactStrategy(effectiveStrategy),
          retrievalHistory: update.retrievalHistory ?? [],
          evidenceCount: evidenceChunks.length,
          graphEvidenceCount: graphChunks.length,
          citationCount: latestCitations.length,
          chunks: graphChunks.slice(0, finalTopK).map((chunk) => ({
            id: chunk.id,
            documentId: chunk.document_id,
            source: chunk.source,
            chunkIndex: chunk.chunk_index,
            category: chunk.category,
            retrievalSources: chunk.retrieval_sources,
            graphScore: chunk.graph_score,
            graphEvidence: chunk.graph_evidence?.slice(0, 3),
          })),
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
  console.error(
    `Graph flow smoke failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
