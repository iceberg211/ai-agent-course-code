import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { RagGoldenCase } from '@/knowledge-content/evaluation/rag-eval.metrics';

export interface RagGoldenSetValidationOptions {
  fixtureDir?: string;
}

export function validateRagGoldenSet(
  goldenSet: RagGoldenCase[],
  options: RagGoldenSetValidationOptions = {},
): string[] {
  return goldenSet.flatMap((item, caseIndex) =>
    validateGoldenCase(item, caseIndex, options),
  );
}

function validateGoldenCase(
  item: RagGoldenCase,
  caseIndex: number,
  options: RagGoldenSetValidationOptions,
): string[] {
  const prefix = `case[${caseIndex}]`;
  const issues: string[] = [];

  requireText(item.id, `${prefix}.id`, issues);
  rejectPlaceholder(item.id, `${prefix}.id`, issues);
  requireText(item.personaId, `${prefix}.personaId`, issues);
  rejectPlaceholder(item.personaId, `${prefix}.personaId`, issues);
  requireText(item.query, `${prefix}.query`, issues);

  if (!Array.isArray(item.expected_answer_points) || item.expected_answer_points.length === 0) {
    issues.push(`${prefix}.expected_answer_points 至少需要 1 条答案要点`);
  }

  if (
    !Array.isArray(item.expected_evidence_spans) ||
    item.expected_evidence_spans.length === 0
  ) {
    issues.push(`${prefix}.expected_evidence_spans 至少需要 1 条稳定证据锚点`);
  } else {
    item.expected_evidence_spans.forEach((span, spanIndex) => {
      const spanPrefix = `${prefix}.expected_evidence_spans[${spanIndex}]`;
      const documentId = normalizeText(span.documentId);
      const source = normalizeText(span.source);
      const hasStableDocumentId =
        Boolean(documentId) && !isPlaceholder(documentId);
      const hasStableSource = Boolean(source) && !isPlaceholder(source);

      rejectPlaceholder(span.documentId, `${spanPrefix}.documentId`, issues);
      rejectPlaceholder(span.source, `${spanPrefix}.source`, issues);
      if (!hasStableDocumentId && !hasStableSource) {
        issues.push(`${spanPrefix} 需要 documentId 或 source 之一`);
      }
      requireText(span.quote, `${spanPrefix}.quote`, issues);
      requireText(span.answerPoint, `${spanPrefix}.answerPoint`, issues);
      validateFixtureQuote(span.source, span.quote, spanPrefix, options, issues);
      rejectPlaceholderList(
        span.snapshotChunkIds,
        `${spanPrefix}.snapshotChunkIds`,
        issues,
      );
    });
  }

  rejectPlaceholderList(
    item.snapshot_chunk_ids,
    `${prefix}.snapshot_chunk_ids`,
    issues,
  );

  return issues;
}

function validateFixtureQuote(
  source: string,
  quote: string,
  spanPrefix: string,
  options: RagGoldenSetValidationOptions,
  issues: string[],
): void {
  if (!options.fixtureDir) return;
  const normalizedSource = normalizeText(source);
  const normalizedQuote = normalizeText(quote);
  if (!normalizedSource || !normalizedQuote || isPlaceholder(normalizedSource)) {
    return;
  }

  const sourcePath = resolveFixturePath(options.fixtureDir, normalizedSource);
  if (!sourcePath) {
    issues.push(`${spanPrefix}.source 不能超出 fixture 目录`);
    return;
  }
  if (!existsSync(sourcePath)) {
    issues.push(`${spanPrefix}.source 对应 fixture 不存在：${normalizedSource}`);
    return;
  }

  const content = readFileSync(sourcePath, 'utf8');
  if (!normalizeForMatch(content).includes(normalizeForMatch(normalizedQuote))) {
    issues.push(`${spanPrefix}.quote 不在 fixture source 中`);
  }
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

function requireText(value: unknown, path: string, issues: string[]): void {
  if (!normalizeText(value)) {
    issues.push(`${path} 不能为空`);
  }
}

function rejectPlaceholder(
  value: unknown,
  path: string,
  issues: string[],
): void {
  const text = normalizeText(value);
  if (text && isPlaceholder(text)) {
    issues.push(`${path} 不能是占位值`);
  }
}

function rejectPlaceholderList(
  values: string[] | undefined,
  path: string,
  issues: string[],
): void {
  if (!Array.isArray(values)) return;
  if (values.some((value) => isPlaceholder(value))) {
    issues.push(`${path} 只能作为快照提示，不能使用占位值`);
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

function isPlaceholder(value: string): boolean {
  return /^replace-with-/i.test(value) || value === 'xxx';
}
