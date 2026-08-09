import type {
  RagKnowledgeCitation,
  RagWorkflowResult,
} from '@/agent/types/rag-workflow.types';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

export interface RagAgentGoldenEvidenceSpan {
  source: string;
  quote: string;
  answerPoint?: string;
}

export interface RagAgentGoldenCase {
  id: string;
  personaId: string;
  query: string;
  profileId?: string;
  expected_evidence_spans: RagAgentGoldenEvidenceSpan[];
  expected_answer_points: string[];
}

export interface RagAgentGoldenEvaluation {
  id: string;
  passed: boolean;
  evidenceHitCount: number;
  evidenceCount: number;
  evidenceRecall: number;
  answerPointHitCount: number;
  answerPointCount: number;
  answerPointRecall: number;
  retrievedChunkCount: number;
  stopReason: string;
}

export function evaluateRagAgentGoldenCase(
  goldenCase: RagAgentGoldenCase,
  result: RagWorkflowResult,
): RagAgentGoldenEvaluation {
  const knowledgeCitations = result.citations.filter(
    (item): item is RagKnowledgeCitation => item.kind === 'knowledge',
  );
  const chunks = deduplicateChunks<KnowledgeChunk>([
    ...(result.state.topDocuments ?? []),
    ...knowledgeCitations,
  ]);
  const evidenceHitCount = goldenCase.expected_evidence_spans.filter((span) =>
    chunks.some((chunk) => {
      const sourceMatches =
        !span.source.trim() ||
        normalizeSource(chunk.source).endsWith(normalizeSource(span.source));
      return (
        sourceMatches &&
        normalizeComparableText(chunk.content).includes(
          normalizeComparableText(span.quote),
        )
      );
    }),
  ).length;
  const normalizedAnswer = normalizeComparableText(result.answerText);
  const answerPointHitCount = goldenCase.expected_answer_points.filter(
    (point) => normalizedAnswer.includes(normalizeComparableText(point)),
  ).length;
  const evidenceRecall = ratio(
    evidenceHitCount,
    goldenCase.expected_evidence_spans.length,
  );
  const answerPointRecall = ratio(
    answerPointHitCount,
    goldenCase.expected_answer_points.length,
  );

  return {
    id: goldenCase.id,
    passed: evidenceRecall === 1 && answerPointRecall === 1,
    evidenceHitCount,
    evidenceCount: goldenCase.expected_evidence_spans.length,
    evidenceRecall,
    answerPointHitCount,
    answerPointCount: goldenCase.expected_answer_points.length,
    answerPointRecall,
    retrievedChunkCount: chunks.length,
    stopReason: result.state.stopReason,
  };
}

export function parseRagAgentGoldenCases(value: unknown): RagAgentGoldenCase[] {
  if (!Array.isArray(value)) {
    throw new Error('golden set 顶层必须是数组');
  }
  return value.map((item, index) => {
    const row = toRecord(item);
    const id = readRequiredString(row, 'id', index);
    const personaId = readRequiredString(row, 'personaId', index);
    const query = readRequiredString(row, 'query', index);
    const evidence = Array.isArray(row.expected_evidence_spans)
      ? row.expected_evidence_spans.map((span, spanIndex) => {
          const spanRow = toRecord(span);
          return {
            source: readRequiredString(spanRow, 'source', index, spanIndex),
            quote: readRequiredString(spanRow, 'quote', index, spanIndex),
            answerPoint: readOptionalString(spanRow.answerPoint),
          };
        })
      : [];
    const answerPoints = Array.isArray(row.expected_answer_points)
      ? row.expected_answer_points
          .map(readOptionalString)
          .filter((item): item is string => Boolean(item))
      : [];

    return {
      id,
      personaId,
      query,
      profileId: readOptionalString(row.profileId),
      expected_evidence_spans: evidence,
      expected_answer_points: answerPoints,
    };
  });
}

function deduplicateChunks<T extends { id: string }>(chunks: T[]): T[] {
  const unique = new Map<string, T>();
  for (const chunk of chunks) {
    if (chunk?.id && !unique.has(chunk.id)) unique.set(chunk.id, chunk);
  }
  return Array.from(unique.values());
}

function normalizeComparableText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeSource(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase();
}

function ratio(value: number, total: number): number {
  if (total === 0) return 1;
  return Number((value / total).toFixed(4));
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('golden set 条目必须是对象');
  }
  return value as Record<string, unknown>;
}

function readRequiredString(
  row: Record<string, unknown>,
  key: string,
  index: number,
  childIndex?: number,
): string {
  const value = readOptionalString(row[key]);
  if (value) return value;
  const location =
    childIndex === undefined
      ? `第 ${index + 1} 条`
      : `第 ${index + 1} 条证据 ${childIndex + 1}`;
  throw new Error(`${location}缺少 ${key}`);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
