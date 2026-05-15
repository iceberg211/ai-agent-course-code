import { createHash } from 'node:crypto';

export interface RagRaptorPlanChunk {
  id: string;
  content: string;
  source: string;
  chunkIndex: number;
}

export interface BuildRagRaptorTreePlanInput {
  knowledgeId: string;
  chunks: RagRaptorPlanChunk[];
  fanout: number;
  maxLayers: number;
}

export interface RagRaptorNodePlan {
  nodeKey: string;
  layer: number;
  sourceChunkIds: string[];
  childNodeKeys: string[];
  summaryInput: string;
}

export interface RagRaptorLayerPlan {
  layer: number;
  nodes: RagRaptorNodePlan[];
}

export interface RagRaptorTreePlan {
  rootNodeKey: string | null;
  layers: RagRaptorLayerPlan[];
  nodeCount: number;
}

interface RaptorPlanSeed {
  sourceChunkIds: string[];
  childNodeKeys: string[];
  summaryInput: string;
}

export function buildRagRaptorTreePlan(
  input: BuildRagRaptorTreePlanInput,
): RagRaptorTreePlan {
  if (input.chunks.length === 0) {
    return {
      rootNodeKey: null,
      layers: [],
      nodeCount: 0,
    };
  }

  const fanout = clampInteger(input.fanout, 2, 20);
  const maxLayers = clampInteger(input.maxLayers, 1, 6);
  let seeds: RaptorPlanSeed[] = input.chunks
    .slice()
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.chunkIndex - right.chunkIndex ||
        left.id.localeCompare(right.id),
    )
    .map((chunk) => ({
      sourceChunkIds: [chunk.id],
      childNodeKeys: [],
      summaryInput: `[${chunk.source}#${chunk.chunkIndex}] ${chunk.content}`,
    }));

  const layers: RagRaptorLayerPlan[] = [];

  for (let layer = 1; layer <= maxLayers && seeds.length > 1; layer += 1) {
    const nodes = chunkArray(seeds, fanout).map((group, groupIndex) =>
      buildNodePlan(input.knowledgeId, layer, groupIndex, group),
    );
    layers.push({ layer, nodes });
    seeds = nodes.map((node) => ({
      sourceChunkIds: node.sourceChunkIds,
      childNodeKeys: [node.nodeKey],
      summaryInput: `[RAPTOR L${node.layer}] ${node.summaryInput}`,
    }));
  }

  const lastLayer = layers.at(-1);
  return {
    rootNodeKey: lastLayer?.nodes.at(-1)?.nodeKey ?? null,
    layers,
    nodeCount: layers.reduce((sum, layer) => sum + layer.nodes.length, 0),
  };
}

function buildNodePlan(
  knowledgeId: string,
  layer: number,
  groupIndex: number,
  group: RaptorPlanSeed[],
): RagRaptorNodePlan {
  const sourceChunkIds = Array.from(
    new Set(group.flatMap((item) => item.sourceChunkIds)),
  );
  const childNodeKeys = group.flatMap((item) => item.childNodeKeys);
  const keyMaterial = [
    knowledgeId,
    layer,
    groupIndex,
    sourceChunkIds.join(','),
    childNodeKeys.join(','),
  ].join('|');

  return {
    nodeKey: `raptor:${knowledgeId}:l${layer}:g${groupIndex}:${hashKey(
      keyMaterial,
    )}`,
    layer,
    sourceChunkIds,
    childNodeKeys,
    summaryInput: group.map((item) => item.summaryInput).join('\n\n'),
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
