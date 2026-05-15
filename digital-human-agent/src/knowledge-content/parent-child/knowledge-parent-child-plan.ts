export const DEFAULT_PARENT_CHILD_INDEX_VERSION = 'parent-child-v1';
export const DEFAULT_PARENT_CHILD_MAX_CHARS = 2000;
export const DEFAULT_PARENT_CHILD_MAX_CHILD_CHUNKS = 5;

export interface ParentChildPlanChunk {
  id: string;
  chunkIndex: number;
  source: string;
  category: string | null;
  content: string;
}

export interface BuildKnowledgeParentChildUpsertPlanInput {
  documentId: string;
  indexVersion?: string;
  maxParentChars?: number;
  maxChildChunks?: number;
  chunks: ParentChildPlanChunk[];
}

export interface KnowledgeParentChunkPlan {
  parentKey: string;
  documentId: string;
  indexVersion: string;
  content: string;
  source: string;
  category: string | null;
  startChunkIndex: number;
  endChunkIndex: number;
  childChunkIds: string[];
  children: ParentChildPlanChunk[];
  metadata: Record<string, unknown>;
}

export interface KnowledgeParentChildUpsertPlan {
  documentId: string;
  indexVersion: string;
  parentChunks: KnowledgeParentChunkPlan[];
}

export function buildKnowledgeParentChildUpsertPlan(
  input: BuildKnowledgeParentChildUpsertPlanInput,
): KnowledgeParentChildUpsertPlan {
  const indexVersion =
    input.indexVersion?.trim() || DEFAULT_PARENT_CHILD_INDEX_VERSION;
  const sortedChunks = input.chunks
    .slice()
    .sort(
      (left, right) =>
        left.chunkIndex - right.chunkIndex || left.id.localeCompare(right.id),
    );
  const maxParentChars = normalizePositiveInteger(
    input.maxParentChars,
    DEFAULT_PARENT_CHILD_MAX_CHARS,
  );
  const maxChildChunks = normalizePositiveInteger(
    input.maxChildChunks,
    DEFAULT_PARENT_CHILD_MAX_CHILD_CHUNKS,
  );
  const groups: ParentChildPlanChunk[][] = [];
  let currentGroup: ParentChildPlanChunk[] = [];

  for (const chunk of sortedChunks) {
    const nextGroup = [...currentGroup, chunk];
    const nextContentLength = joinChunkContent(nextGroup).length;
    const shouldStartNewGroup =
      currentGroup.length > 0 &&
      (nextGroup.length > maxChildChunks || nextContentLength > maxParentChars);

    if (shouldStartNewGroup) {
      groups.push(currentGroup);
      currentGroup = [chunk];
    } else {
      currentGroup = nextGroup;
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return {
    documentId: input.documentId,
    indexVersion,
    parentChunks: groups.map((group) =>
      buildParentChunkPlan(input.documentId, indexVersion, group),
    ),
  };
}

function buildParentChunkPlan(
  documentId: string,
  indexVersion: string,
  children: ParentChildPlanChunk[],
): KnowledgeParentChunkPlan {
  const startChunkIndex = children[0]?.chunkIndex ?? 0;
  const endChunkIndex = children.at(-1)?.chunkIndex ?? startChunkIndex;

  return {
    parentKey: `ParentChunk:${documentId}:${indexVersion}:${startChunkIndex}-${endChunkIndex}`,
    documentId,
    indexVersion,
    content: joinChunkContent(children),
    source: children[0]?.source ?? '',
    category: children[0]?.category ?? null,
    startChunkIndex,
    endChunkIndex,
    childChunkIds: children.map((chunk) => chunk.id),
    children,
    metadata: {
      childCount: children.length,
      childChunkIds: children.map((chunk) => chunk.id),
    },
  };
}

function joinChunkContent(chunks: ParentChildPlanChunk[]): string {
  return chunks.map((chunk) => chunk.content).join('\n\n');
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}
