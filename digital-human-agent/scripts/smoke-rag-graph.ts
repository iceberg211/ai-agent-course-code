import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { createRetrieveEvidenceNode } from '@/agent/langgraph/nodes/retrieve.node';
import { buildInitialRagGraphState } from '@/agent/langgraph/rag.state';
import { normalizeRetrievalStrategy } from '@/agent/retrieval-strategy.utils';
import type { RagCitation } from '@/agent/types/rag-workflow.types';
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

function readFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
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

function buildGraphStrategy() {
  process.env.ENABLE_GRAPH_RETRIEVAL = 'true';
  process.env.RAG_SEMANTIC_CACHE_ENABLED = 'false';

  return normalizeRetrievalStrategy({
    needRetrieval: true,
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
    graphMode: 'path',
    graphMaxHops: readPositiveIntArg('graphMaxHops', 2),
    reason: 'Graph smoke：只验证 PostgreSQL 图谱召回，不调用模型',
  });
}

async function main(): Promise<void> {
  const requestedQuery = readArg('query');
  const finalTopK = readPositiveIntArg('topK', 3);
  const showContent = readFlag('show-content');

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

    const strategy = buildGraphStrategy();
    const knowledgeSearchService = app.get(KnowledgeSearchService);
    const retrieveOnlyKnowledgeSearchService = {
      retrieveForPersona: (
        nextPersonaId: string,
        nextQuery: string,
        options: Parameters<KnowledgeSearchService['retrieveForPersona']>[2],
      ) =>
        knowledgeSearchService.retrieveForPersona(nextPersonaId, nextQuery, {
          ...options,
          finalTopK,
          rerank: false,
          skipQueryRewrite: true,
        }),
    };
    const node = createRetrieveEvidenceNode(
      retrieveOnlyKnowledgeSearchService as KnowledgeSearchService,
    );
    let latestCitations: RagCitation[] = [];
    const workflowInput = {
      conversationId: 'rag-graph-smoke',
      personaId,
      question: query,
      turnId: `rag-graph-smoke-${Date.now()}`,
      signal: new AbortController().signal,
      onToken: () => undefined,
      onCitations: (citations: RagCitation[]) => {
        latestCitations = citations;
      },
    };
    const state = {
      ...buildInitialRagGraphState(workflowInput),
      strategy: 'simple' as const,
      routeReason: 'Graph smoke 直接验证 retrieve_evidence 节点',
      retrievalStrategy: strategy,
      retrievalStrategyReason: strategy.reason,
    };

    const update = await node(state, {
      configurable: { workflowInput },
      context: { workflowInput },
    } as never);
    const evidenceChunks = update.evidenceChunks ?? [];
    const graphChunks = evidenceChunks.filter((chunk) =>
      chunk.retrieval_sources?.includes('graph'),
    );

    if (graphChunks.length === 0) {
      throw new Error(
        `Graph smoke 未召回图谱证据：personaId=${personaId} query=${query}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          status: 'ok',
          action: 'rag-graph-smoke',
          modelCalls: false,
          personaId,
          query,
          graphEnabled: process.env.ENABLE_GRAPH_RETRIEVAL === 'true',
          retrievalHistory: update.retrievalHistory ?? [],
          currentHop: update.currentHop ?? 0,
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
            contentPreview: showContent
              ? chunk.content.slice(0, 240)
              : undefined,
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
    `Graph smoke failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
