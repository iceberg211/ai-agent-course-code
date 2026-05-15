import { createHash } from 'node:crypto';
import type { RetrievalStrategy } from '@/agent/types/rag-workflow.types';
import type { KnowledgeRetrievalConfig } from '@/knowledge/knowledge.entity';

export interface MountedKnowledgeBaseCacheFingerprint {
  id: string;
  fingerprint: string;
}

export interface KnowledgeBaseCacheFingerprintInput {
  id: string;
  updatedAt?: Date | string | null;
  documentCount: number;
  completedDocumentCount?: number | null;
  chunkCount: number;
  maxDocumentCreatedAt?: Date | string | null;
  maxChunkCreatedAt?: Date | string | null;
  retrievalConfig?: Partial<KnowledgeRetrievalConfig>;
  indexVersions?: {
    elasticsearch?: string | null;
    graph?: string | null;
    parentChild?: string | null;
    chunking?: string | null;
  };
}

export interface KnowledgeBaseCacheFingerprintMaterial {
  version: 'kb-fingerprint-v1';
  id: string;
  updatedAt: string | null;
  documentStats: {
    documentCount: number;
    completedDocumentCount: number | null;
    chunkCount: number;
    maxDocumentCreatedAt: string | null;
    maxChunkCreatedAt: string | null;
  };
  retrievalConfig: RagSemanticCacheKeyMaterial['retrievalConfig'];
  indexVersions: RagSemanticCacheKeyMaterial['indexVersions'];
}

export interface RagSemanticCacheKeyInput {
  query: string;
  personaId: string;
  mountedKnowledgeBases: MountedKnowledgeBaseCacheFingerprint[];
  retrievalConfig: Partial<KnowledgeRetrievalConfig>;
  embeddingModel: string;
  rerankerProvider: string;
  rerankerModel: string | null;
  allowWeb: boolean;
  strategyFlags: Partial<RetrievalStrategy>;
  indexVersions?: {
    elasticsearch?: string | null;
    graph?: string | null;
    parentChild?: string | null;
    chunking?: string | null;
  };
}

export interface RagSemanticCacheKeyMaterial {
  version: 'v1';
  normalizedQueryHash: string;
  personaId: string;
  mountedKnowledgeBaseIds: string[];
  mountedKnowledgeBaseFingerprints: string[];
  retrievalConfig: {
    threshold: number | null;
    stage1TopK: number | null;
    finalTopK: number | null;
    rerank: boolean | null;
  };
  embeddingModel: string;
  rerankerProvider: string;
  rerankerModel: string | null;
  allowWeb: boolean;
  strategyFlags: {
    needRetrieval: boolean | null;
    useVector: boolean | null;
    useKeyword: boolean | null;
    useGraph: boolean | null;
    useExactPhrase: boolean | null;
    useMultiQuery: boolean | null;
    useHyDE: boolean | null;
    queryCount: number | null;
    chunkContextWindow: number | null;
    parentContext: boolean | null;
    parentContextMaxChars: number | null;
    contextCompression: boolean | null;
    lostInMiddle: boolean | null;
    graphMode: string | null;
    graphMaxHops: number | null;
  };
  indexVersions: {
    elasticsearch: string | null;
    graph: string | null;
    parentChild: string | null;
    chunking: string | null;
  };
}

export interface RagSemanticCacheKeyResult {
  key: string;
  material: RagSemanticCacheKeyMaterial;
}

export function buildRagSemanticCacheKey(
  input: RagSemanticCacheKeyInput,
): RagSemanticCacheKeyResult {
  const mountedKnowledgeBases = [...input.mountedKnowledgeBases].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const material: RagSemanticCacheKeyMaterial = {
    version: 'v1',
    normalizedQueryHash: sha256(normalizeQuery(input.query)),
    personaId: input.personaId,
    mountedKnowledgeBaseIds: mountedKnowledgeBases.map((item) => item.id),
    mountedKnowledgeBaseFingerprints: mountedKnowledgeBases.map(
      (item) => item.fingerprint,
    ),
    retrievalConfig: normalizeRetrievalConfig(input.retrievalConfig),
    embeddingModel: input.embeddingModel,
    rerankerProvider: input.rerankerProvider,
    rerankerModel: input.rerankerModel,
    allowWeb: input.allowWeb,
    strategyFlags: normalizeStrategyFlags(input.strategyFlags),
    indexVersions: {
      elasticsearch: input.indexVersions?.elasticsearch ?? null,
      graph: input.indexVersions?.graph ?? null,
      parentChild: input.indexVersions?.parentChild ?? null,
      chunking: input.indexVersions?.chunking ?? null,
    },
  };

  return {
    key: `rag-semantic:v1:${sha256(stableStringify(material))}`,
    material,
  };
}

export function buildMountedKnowledgeBaseCacheFingerprint(
  input: KnowledgeBaseCacheFingerprintInput,
): MountedKnowledgeBaseCacheFingerprint {
  const material: KnowledgeBaseCacheFingerprintMaterial = {
    version: 'kb-fingerprint-v1',
    id: input.id,
    updatedAt: normalizeDateTime(input.updatedAt),
    documentStats: {
      documentCount: normalizeCount(input.documentCount),
      completedDocumentCount:
        input.completedDocumentCount === undefined ||
        input.completedDocumentCount === null
          ? null
          : normalizeCount(input.completedDocumentCount),
      chunkCount: normalizeCount(input.chunkCount),
      maxDocumentCreatedAt: normalizeDateTime(input.maxDocumentCreatedAt),
      maxChunkCreatedAt: normalizeDateTime(input.maxChunkCreatedAt),
    },
    retrievalConfig: normalizeRetrievalConfig(input.retrievalConfig ?? {}),
    indexVersions: {
      elasticsearch: input.indexVersions?.elasticsearch ?? null,
      graph: input.indexVersions?.graph ?? null,
      parentChild: input.indexVersions?.parentChild ?? null,
      chunking: input.indexVersions?.chunking ?? null,
    },
  };

  return {
    id: input.id,
    fingerprint: `kb-fingerprint:v1:${input.id}:${sha256(
      stableStringify(material),
    )}`,
  };
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeRetrievalConfig(config: Partial<KnowledgeRetrievalConfig>) {
  return {
    threshold: toFiniteNumberOrNull(config.threshold),
    stage1TopK: toFiniteNumberOrNull(config.stage1TopK),
    finalTopK: toFiniteNumberOrNull(config.finalTopK),
    rerank: typeof config.rerank === 'boolean' ? config.rerank : null,
  };
}

function normalizeStrategyFlags(strategy: Partial<RetrievalStrategy>) {
  return {
    needRetrieval: toBooleanOrNull(strategy.needRetrieval),
    useVector: toBooleanOrNull(strategy.useVector),
    useKeyword: toBooleanOrNull(strategy.useKeyword),
    useGraph: toBooleanOrNull(strategy.useGraph),
    useExactPhrase: toBooleanOrNull(strategy.useExactPhrase),
    useMultiQuery: toBooleanOrNull(strategy.useMultiQuery),
    useHyDE: toBooleanOrNull(strategy.useHyDE),
    queryCount: toFiniteNumberOrNull(strategy.queryCount),
    chunkContextWindow: toFiniteNumberOrNull(strategy.chunkContextWindow),
    parentContext: toBooleanOrNull(strategy.parentContext),
    parentContextMaxChars: toFiniteNumberOrNull(strategy.parentContextMaxChars),
    contextCompression: toBooleanOrNull(strategy.contextCompression),
    lostInMiddle: toBooleanOrNull(strategy.lostInMiddle),
    graphMode: strategy.graphMode ?? null,
    graphMaxHops: toFiniteNumberOrNull(strategy.graphMaxHops),
  };
}

function toBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function toFiniteNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeDateTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
