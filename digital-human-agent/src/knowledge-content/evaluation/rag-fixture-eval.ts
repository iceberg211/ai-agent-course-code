import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type {
  RagEvalCaseInput,
  RagGoldenCase,
} from '@/knowledge-content/evaluation/rag-eval.metrics';
import type {
  KnowledgeChunk,
  KnowledgeQueryRewriteResult,
  NormalizedRetrieveKnowledgeOptions,
  RetrieveKnowledgeTraceItem,
  RetrievalQueryItem,
} from '@/knowledge-content/types/knowledge-content.types';

export interface RagFixtureEvalOptions {
  fixtureDir: string;
}

export interface RagEvalReportCase {
  id: string;
  query: string;
  expectedEvidenceSpans?: RagGoldenCase['expected_evidence_spans'];
  expectedAnswerPoints?: string[];
  retrievalQuery: string;
  retrievalQueries: RetrievalQueryItem[];
  rewrite?: KnowledgeQueryRewriteResult;
  options?: NormalizedRetrieveKnowledgeOptions;
  stage1ChunkIds: string[];
  stage2ChunkIds: string[];
  trace: RetrieveKnowledgeTraceItem[];
}

export interface RagFixtureEvalInputs {
  caseInputs: RagEvalCaseInput[];
  cases: RagEvalReportCase[];
}

export function buildRagFixtureEvalInputs(
  goldenSet: RagGoldenCase[],
  options: RagFixtureEvalOptions,
): RagFixtureEvalInputs {
  const caseInputs: RagEvalCaseInput[] = [];
  const cases: RagEvalReportCase[] = [];

  for (const item of goldenSet) {
    const stage1 = buildFixtureChunks(item, options.fixtureDir);
    const finalTopK = item.retrieval_config?.finalTopK ?? 5;
    const stage2 = stage1.slice(0, finalTopK);

    caseInputs.push({
      case: item,
      stage1,
      stage2,
    });
    cases.push({
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
      trace: [buildFixtureTrace(item, stage1.length)],
    });
  }

  return {
    caseInputs,
    cases,
  };
}

function buildFixtureChunks(
  item: RagGoldenCase,
  fixtureDir: string,
): KnowledgeChunk[] {
  const sources = Array.from(
    new Set(
      item.expected_evidence_spans
        .map((span) => span.source?.trim())
        .filter((source): source is string => Boolean(source)),
    ),
  );

  return sources.map((source, index) => {
    const content = readFixtureSource(fixtureDir, source);
    return {
      id: `fixture:${source}`,
      document_id: `fixture:${source}`,
      content,
      source,
      chunk_index: index,
      category: 'fixture',
      similarity: 1,
    };
  });
}

function buildFixtureTrace(
  item: RagGoldenCase,
  chunkCount: number,
): RetrieveKnowledgeTraceItem {
  return {
    knowledgeId: 'fixture',
    queryIndex: 0,
    query: item.query,
    keywords: [item.query],
    angle: 'original',
    vectorBackend: 'disabled',
    keywordBackend: 'disabled',
    graphBackend: 'disabled',
    vectorResultCount: 0,
    hydeVectorResultCount: 0,
    keywordResultCount: 0,
    mergedResultCount: chunkCount,
    fallbackToPg: false,
    skippedChannels: ['vector', 'keyword', 'hyde', 'graph'],
  };
}

function readFixtureSource(fixtureDir: string, source: string): string {
  const sourcePath = resolveFixturePath(fixtureDir, source);
  if (!sourcePath || !existsSync(sourcePath)) {
    throw new Error(`fixture source 不存在：${source}`);
  }

  return readFileSync(sourcePath, 'utf8');
}

function resolveFixturePath(
  fixtureDir: string,
  source: string,
): string | null {
  const baseDir = resolve(fixtureDir);
  const sourcePath = resolve(baseDir, source);
  return sourcePath === baseDir || sourcePath.startsWith(`${baseDir}${sep}`)
    ? sourcePath
    : null;
}
