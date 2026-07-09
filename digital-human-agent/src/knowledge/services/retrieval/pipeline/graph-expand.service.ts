import { Injectable, Logger, Optional } from '@nestjs/common';
import { isAbortError } from '@/common/utils';
import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';
import type {
  KnowledgeAccessScope,
  KnowledgeChunk,
} from '@/knowledge/types/knowledge-content.types';
import type { GraphExpandTraceItem } from '@/knowledge/services/retrieval/pipeline/retrieval-port';
import {
  extractGraphEntitySearchTerms,
  shouldSkipGraphExpand,
} from '@/knowledge/services/retrieval/pipeline/graph-expand.utils';

export interface GraphExpandInput {
  documents: KnowledgeChunk[];
  question: string;
  currentQuery?: string;
  useGraphChannel: boolean;
  graphExpand: boolean;
  accessScope?: KnowledgeAccessScope;
  signal?: AbortSignal;
}

export interface GraphExpandResult {
  chunks: KnowledgeChunk[];
  expandedChunks: KnowledgeChunk[];
  trace: GraphExpandTraceItem[];
  skipped: boolean;
}

@Injectable()
export class GraphExpandService {
  private readonly logger = new Logger(GraphExpandService.name);

  constructor(
    @Optional()
    private readonly graphService?: KnowledgeGraphService,
  ) {}

  async expand(input: GraphExpandInput): Promise<GraphExpandResult> {
    const decision = shouldSkipGraphExpand({
      useGraphChannel: input.useGraphChannel,
      graphExpand: input.graphExpand,
      graphServiceEnabled: this.graphService?.isEnabled() === true,
      documents: input.documents,
    });

    if (decision.skip) {
      return {
        chunks: input.documents,
        expandedChunks: [],
        skipped: true,
        trace: [
          {
            knowledgeId: '*',
            matchedEntities: [],
            expandedChunkIds: [],
            expandedChunkCount: 0,
            skipped: true,
            reason: decision.reason,
          },
        ],
      };
    }

    const graphService = this.graphService!;
    try {
      const topChunks = input.documents.slice(0, 3);
      const docContents = topChunks.map((c) => c.content).join(' ');
      const kbIds = Array.from(
        new Set(
          input.documents
            .map((doc) => doc.knowledge_base_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      if (kbIds.length === 0) {
        return {
          chunks: input.documents,
          expandedChunks: [],
          skipped: true,
          trace: [],
        };
      }

      const queryText = [input.question, input.currentQuery ?? '', docContents]
        .join(' ')
        .trim();
      const entitySearchTerms = extractGraphEntitySearchTerms(queryText);
      if (entitySearchTerms.length === 0) {
        return {
          chunks: input.documents,
          expandedChunks: [],
          skipped: true,
          trace: [
            {
              knowledgeId: '*',
              matchedEntities: [],
              expandedChunkIds: [],
              expandedChunkCount: 0,
              skipped: true,
              reason: '无法从问题与证据中提取实体检索词',
            },
          ],
        };
      }

      const expandedChunks: KnowledgeChunk[] = [];
      const graphReasoningTrace: GraphExpandTraceItem[] = [];
      const existingChunkIds = new Set(input.documents.map((doc) => doc.id));

      for (const kbId of kbIds) {
        const entityRows = await Promise.all(
          entitySearchTerms.map((term) =>
            graphService.listEntities(kbId, term, 12, input.accessScope),
          ),
        );
        const entityByKey = new Map<string, { key: string; name: string }>();
        for (const row of entityRows.flat()) {
          if (row?.key) {
            entityByKey.set(String(row.key), {
              key: String(row.key),
              name: String(row.name ?? ''),
            });
          }
        }
        if (entityByKey.size === 0) {
          graphReasoningTrace.push({
            knowledgeId: kbId,
            matchedEntities: [],
            expandedChunkIds: [],
            expandedChunkCount: 0,
            skipped: true,
            reason: '实体检索词未命中图谱实体',
          });
          continue;
        }

        const entities = Array.from(entityByKey.values());
        const entityMatchText = [
          docContents,
          input.question,
          input.currentQuery ?? '',
        ]
          .join(' ')
          .toLowerCase();
        const matchedEntities = entities
          .filter((ent) => {
            const name = ent.name.trim();
            if (name.length < 2) return false;
            return entityMatchText.includes(name.toLowerCase());
          })
          .sort((left, right) => right.name.length - left.name.length);

        const expandedChunkIds = new Set<string>();
        for (const ent of matchedEntities.slice(0, 2)) {
          const neighborChunks = await graphService.getNeighborhood(
            kbId,
            ent.key,
            input.accessScope,
          );
          for (const row of neighborChunks) {
            if (existingChunkIds.has(row.id) || expandedChunkIds.has(row.id)) {
              continue;
            }
            expandedChunkIds.add(row.id);
            expandedChunks.push({
              id: row.id,
              document_id: row.document_id,
              knowledge_base_id: row.knowledge_base_id,
              content: row.content,
              source: row.source,
              chunk_index: Number(row.chunk_index) || 0,
              category: row.category,
              similarity: 0,
              graph_score: Number(row.confidence) || 0.5,
              retrieval_sources: ['graph'],
              graph_evidence: row.evidenceText
                ? [
                    {
                      source: row.sourceName ?? ent.name,
                      target: row.targetName ?? row.source,
                      relationType: row.relationType ?? 'RELATED_TO',
                      relationLabel: row.relationLabel ?? null,
                      evidenceText: row.evidenceText,
                      confidence: Number(row.confidence) || 0.5,
                    },
                  ]
                : [],
              matched_queries: [],
            });
          }
        }

        graphReasoningTrace.push({
          knowledgeId: kbId,
          matchedEntities: matchedEntities.slice(0, 2).map((ent) => ({
            key: ent.key,
            name: ent.name,
          })),
          expandedChunkIds: Array.from(expandedChunkIds),
          expandedChunkCount: expandedChunkIds.size,
          skipped: expandedChunkIds.size === 0,
          reason:
            expandedChunkIds.size === 0 ? '未找到可见的邻居证据' : undefined,
        });
      }

      return {
        chunks: input.documents,
        expandedChunks,
        skipped: expandedChunks.length === 0,
        trace: graphReasoningTrace,
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      this.logger.warn(
        `Graph expand 失败，回退原文档：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        chunks: input.documents,
        expandedChunks: [],
        skipped: true,
        trace: [
          {
            knowledgeId: '*',
            matchedEntities: [],
            expandedChunkIds: [],
            expandedChunkCount: 0,
            skipped: true,
            error: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }
}
