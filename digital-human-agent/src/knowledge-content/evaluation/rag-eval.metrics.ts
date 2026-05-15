import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

export interface RagGoldenEvidenceSpan {
  documentId: string;
  source: string;
  quote: string;
  answerPoint: string;
  snapshotChunkIds?: string[];
}

export interface RagGoldenCase {
  id: string;
  personaId: string;
  query: string;
  expected_evidence_spans: RagGoldenEvidenceSpan[];
  snapshot_chunk_ids?: string[];
  expected_answer_points: string[];
  retrieval_config?: {
    threshold?: number;
    stage1TopK?: number;
    finalTopK?: number;
    rerank?: boolean;
  };
}

export interface RagEvalCaseInput {
  case: RagGoldenCase;
  stage1: KnowledgeChunk[];
  stage2: KnowledgeChunk[];
}

export interface RagEvalCaseResult {
  id: string;
  query: string;
  stage1EvidenceHitAtK: number;
  stage2EvidenceHitAtK: number;
  mrr: number;
  rerankRetention: number;
  answerPointCoverage: number;
}

export interface RagEvalMetrics {
  caseResults: RagEvalCaseResult[];
  summary: Omit<RagEvalCaseResult, 'id' | 'query'> & {
    caseCount: number;
  };
}

export function calculateRagEvalMetrics(
  inputs: RagEvalCaseInput[],
): RagEvalMetrics {
  const caseResults = inputs.map((input) => {
    const stage1HitRanks = findEvidenceHitRanks(
      input.stage1,
      input.case.expected_evidence_spans,
    );
    const stage2HitRanks = findEvidenceHitRanks(
      input.stage2,
      input.case.expected_evidence_spans,
    );
    const firstRank = stage1HitRanks.find((rank) => rank > 0) ?? 0;
    const stage1HitCount = stage1HitRanks.filter((rank) => rank > 0).length;
    const stage2HitCount = stage2HitRanks.filter((rank) => rank > 0).length;

    return {
      id: input.case.id,
      query: input.case.query,
      stage1EvidenceHitAtK: toRatio(
        stage1HitCount,
        input.case.expected_evidence_spans.length,
      ),
      stage2EvidenceHitAtK: toRatio(
        stage2HitCount,
        input.case.expected_evidence_spans.length,
      ),
      mrr: firstRank > 0 ? 1 / firstRank : 0,
      rerankRetention: toRatio(stage2HitCount, Math.max(stage1HitCount, 1)),
      answerPointCoverage: calculateAnswerPointCoverage(
        input.stage2,
        input.case.expected_answer_points,
      ),
    };
  });

  return {
    caseResults,
    summary: {
      caseCount: caseResults.length,
      stage1EvidenceHitAtK: average(
        caseResults.map((item) => item.stage1EvidenceHitAtK),
      ),
      stage2EvidenceHitAtK: average(
        caseResults.map((item) => item.stage2EvidenceHitAtK),
      ),
      mrr: average(caseResults.map((item) => item.mrr)),
      rerankRetention: average(caseResults.map((item) => item.rerankRetention)),
      answerPointCoverage: average(
        caseResults.map((item) => item.answerPointCoverage),
      ),
    },
  };
}

function findEvidenceHitRanks(
  chunks: KnowledgeChunk[],
  spans: RagGoldenEvidenceSpan[],
): number[] {
  return spans.map((span) => {
    const index = chunks.findIndex((chunk) => evidenceMatches(chunk, span));
    return index >= 0 ? index + 1 : 0;
  });
}

function evidenceMatches(
  chunk: KnowledgeChunk,
  span: RagGoldenEvidenceSpan,
): boolean {
  const documentMatches =
    !span.documentId ||
    chunk.document_id === span.documentId ||
    span.snapshotChunkIds?.includes(chunk.id) === true;
  const sourceMatches = !span.source || chunk.source === span.source;
  const quoteMatches =
    !span.quote || normalizeText(chunk.content).includes(normalizeText(span.quote));

  return documentMatches && sourceMatches && quoteMatches;
}

function calculateAnswerPointCoverage(
  chunks: KnowledgeChunk[],
  answerPoints: string[],
): number {
  const normalizedContext = normalizeText(
    chunks.map((chunk) => chunk.content).join('\n'),
  );
  const covered = answerPoints.filter((point) =>
    normalizedContext.includes(normalizeText(point)),
  ).length;
  return toRatio(covered, answerPoints.length);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

function toRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
