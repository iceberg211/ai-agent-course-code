import { Command } from '@langchain/langgraph';
import { isAbortError } from '@/common/utils';
import { QueryAugmentationService } from '@/agent/services/query-augmentation.service';
import { WebFallbackService } from '@/agent/services/web-fallback.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import {
  getNextQuery,
  mergeEvidenceChunks,
  publishCitations,
  toWorkflowCitations,
  mergeWebCitations,
} from '@/agent/langgraph/rag.utils';
import {
  isBeforeFinalRetryAttempt,
  isTransientRagDependencyError,
} from '@/agent/langgraph/rag.retry-policy';
import { HybridRetrieverService } from '@/knowledge/services/retrieval/channels/hybrid-retriever.service';
import { KnowledgeGraphService } from '@/knowledge/graph/knowledge-graph.service';
import type { KnowledgeChunk } from '@/knowledge/types/knowledge-content.types';

// ==========================================
// 1. retrieve 节点
// ==========================================
export function createRetrieveNode(
  queryAugmentationService: QueryAugmentationService,
  hybridRetrieverService: HybridRetrieverService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    const currentQuery = getNextQuery(state);

    if (!currentQuery) {
      return {};
    }

    const augmentation = await queryAugmentationService.plan({
      question: currentQuery,
      routeStrategy: state.strategy,
      history: state.history,
      signal: input.signal,
    });

    const update = {
      currentQuery,
      retrievalStrategy: augmentation.strategy,
      retrievalStrategyReason: augmentation.strategy.reason,
      currentHop: state.currentHop + 1,
      nextSubIdx: state.nextSubIdx + 1,
      topDocuments: [],
      plannedNext: '',
    } satisfies Partial<RagGraphState>;

    if (
      !augmentation.strategy.needRetrieval ||
      augmentation.retrievalQueries.length === 0
    ) {
      return {
        ...update,
        retrievalHistory: [
          ...state.retrievalHistory,
          {
            query: currentQuery,
            resultCount: 0,
            skipped: true,
            reason: augmentation.strategy.reason,
            strategy: augmentation.strategy,
          },
        ],
        stopReason: 'retrieval_skipped',
      } satisfies Partial<RagGraphState>;
    }

    const stage1Result = await hybridRetrieverService.retrieveForPersona({
      personaId: input.personaId,
      retrievalQueries: augmentation.retrievalQueries,
      strategy: augmentation.strategy,
      accessScope: input.accessScope,
      signal: input.signal,
    });

    const documents = mergeEvidenceChunks(state.documents, stage1Result.chunks);

    publishCitations(
      input,
      toWorkflowCitations({
        documents,
        topDocuments: [],
        evidenceChunks: documents,
        webCitations: state.webCitations,
      }),
    );

    return {
      ...update,
      documents,
      evidenceChunks: documents,
      retrievalTrace: [...state.retrievalTrace, ...stage1Result.trace],
      retrievalHistory: [
        ...state.retrievalHistory,
        {
          query: currentQuery,
          resultCount: stage1Result.chunks.length,
          strategy: augmentation.strategy,
        },
      ],
      stopReason: '',
      rerankLimit: stage1Result.rerankLimit ?? state.rerankLimit,
    } satisfies Partial<RagGraphState>;
  };
}

// ==========================================
// 2. web_fallback 节点
// ==========================================
export function createWebFallbackNode(webFallbackService: WebFallbackService) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);

    if (!webFallbackService.isEnabled()) {
      return new Command({
        update: {
          stopReason: 'web_fallback_disabled',
        } satisfies Partial<RagGraphState>,
        goto: 'load_context',
      });
    }

    const webQuery = state.webQuery.trim() || state.question;
    const previousAttempts = Number.isFinite(state.webSearchAttempts)
      ? state.webSearchAttempts
      : state.webSearchAttempted
        ? 1
        : 0;
    const webSearchAttempts = previousAttempts + 1;
    const webSearchQueries = Array.from(
      new Set([...(state.webSearchQueries ?? []), webQuery]),
    );

    try {
      const webCitations = await webFallbackService.search({
        query: webQuery,
        signal: input.signal,
      });

      if (webCitations.length === 0) {
        return new Command({
          update: {
            webQuery,
            webSearchAttempted: true,
            webSearchAttempts,
            webSearchQueries,
            stopReason: 'web_fallback_empty',
          } satisfies Partial<RagGraphState>,
          goto: 'load_context',
        });
      }

      const mergedWebCitations = mergeWebCitations(
        state.webCitations,
        webCitations,
      );

      publishCitations(
        input,
        toWorkflowCitations({
          documents: state.documents,
          topDocuments: state.topDocuments,
          evidenceChunks: state.topDocuments,
          webCitations: mergedWebCitations,
        }),
      );

      return new Command({
        update: {
          webQuery,
          webSearchAttempted: true,
          webSearchAttempts,
          webSearchQueries,
          webCitations: mergedWebCitations,
          webSearchUsed: true,
        } satisfies Partial<RagGraphState>,
        goto: 'evaluate_evidence',
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      if (
        isTransientRagDependencyError(error) &&
        isBeforeFinalRetryAttempt(config.executionInfo?.nodeAttempt)
      ) {
        throw error;
      }

      return new Command({
        update: {
          webQuery,
          webSearchAttempted: true,
          webSearchAttempts,
          webSearchQueries,
          stopReason: 'web_fallback_failed',
        } satisfies Partial<RagGraphState>,
        goto: 'load_context',
      });
    }
  };
}

// ==========================================
// 3. graph_reasoning 节点
// ==========================================
export function createGraphReasoningNode(
  graphService: KnowledgeGraphService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);

    // 如果检索策略里没有开启 useGraph，直接跳过
    if (!state.retrievalStrategy.useGraph) {
      return {};
    }

    try {
      if (!graphService.isEnabled()) {
        return {
          graphReasoningTrace: [
            ...(state.graphReasoningTrace ?? []),
            {
              knowledgeId: '*',
              matchedEntities: [],
              expandedChunkIds: [],
              expandedChunkCount: 0,
              skipped: true,
              reason: '图谱服务未启用',
            },
          ],
        } satisfies Partial<RagGraphState>;
      }

      // hybrid 通道已带回足够图谱证据时，跳过二次一跳扩展，降低噪声与延迟
      const existingGraphHits = state.documents.filter(
        (doc) =>
          doc.retrieval_sources?.includes('graph') ||
          (doc.graph_score ?? 0) > 0 ||
          (doc.graph_evidence?.length ?? 0) > 0,
      ).length;
      if (existingGraphHits >= 3) {
        return {
          graphReasoningTrace: [
            ...(state.graphReasoningTrace ?? []),
            {
              knowledgeId: '*',
              matchedEntities: [],
              expandedChunkIds: [],
              expandedChunkCount: 0,
              skipped: true,
              reason: `hybrid 已命中 ${existingGraphHits} 条图谱证据，跳过二次扩展`,
            },
          ],
        } satisfies Partial<RagGraphState>;
      }

      // 1. 获取现有召回的 Top 3 chunks 作为实体匹配材料
      const topChunks = state.documents.slice(0, 3);
      if (topChunks.length === 0) return {};

      const docContents = topChunks.map((c) => c.content).join(' ');

      // 2. 捞取召回 chunk 所属的 knowledge_base_ids
      const kbIds = Array.from(
        new Set(
          state.documents
            .map((doc) => doc.knowledge_base_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      if (kbIds.length === 0) return {};

      const entitySearchTerms = extractGraphEntitySearchTerms(
        [state.question, currentQueryText(state), docContents].join(' '),
      );
      if (entitySearchTerms.length === 0) {
        return {
          graphReasoningTrace: [
            ...(state.graphReasoningTrace ?? []),
            {
              knowledgeId: '*',
              matchedEntities: [],
              expandedChunkIds: [],
              expandedChunkCount: 0,
              skipped: true,
              reason: '无法从问题与证据中提取实体检索词',
            },
          ],
        } satisfies Partial<RagGraphState>;
      }

      const expandedChunks: KnowledgeChunk[] = [];
      const graphReasoningTrace: RagGraphState['graphReasoningTrace'] = [];
      const existingChunkIds = new Set(state.documents.map((doc) => doc.id));

      for (const kbId of kbIds) {
        const entityRows = await Promise.all(
          entitySearchTerms.map((term) =>
            graphService.listEntities(kbId, term, 12, input.accessScope),
          ),
        );
        const entityByKey = new Map<string, any>();
        for (const row of entityRows.flat()) {
          if (row?.key) entityByKey.set(String(row.key), row);
        }
        // 不再做空 term 全量实体 fallback，避免噪声注入与额外 Neo4j 开销
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
          state.question,
          currentQueryText(state),
        ]
          .join(' ')
          .toLowerCase();
        // 优先精确匹配实体名；要求实体名至少 2 字，降低短词误匹配
        const matchedEntities = entities
          .filter((ent) => {
            const name = String(ent.name ?? '').trim();
            if (name.length < 2) return false;
            return entityMatchText.includes(name.toLowerCase());
          })
          .sort(
            (left, right) =>
              String(right.name ?? '').length - String(left.name ?? '').length,
          );
        const expandedChunkIds = new Set<string>();

        // 最多对 2 个实体进行一跳邻近节点推理，避免关系爆炸
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
            key: String(ent.key),
            name: String(ent.name),
          })),
          expandedChunkIds: Array.from(expandedChunkIds),
          expandedChunkCount: expandedChunkIds.size,
          skipped: expandedChunkIds.size === 0,
          reason:
            expandedChunkIds.size === 0 ? '未找到可见的邻居证据' : undefined,
        });
      }

      if (expandedChunks.length === 0) {
        return {
          graphReasoningTrace: [
            ...(state.graphReasoningTrace ?? []),
            ...graphReasoningTrace,
          ],
        } satisfies Partial<RagGraphState>;
      }

      // 3. 把通过图关系发掘扩展出的 chunks 合并到已召回的 documents 中（去重）
      const documents = mergeEvidenceChunks(state.documents, expandedChunks);

      publishCitations(
        input,
        toWorkflowCitations({
          documents,
          topDocuments: [],
          evidenceChunks: documents,
          webCitations: state.webCitations,
        }),
      );

      return {
        documents,
        evidenceChunks: documents,
        graphReasoningTrace: [
          ...(state.graphReasoningTrace ?? []),
          ...graphReasoningTrace,
        ],
      } satisfies Partial<RagGraphState>;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      // 容错返回空，图谱失败不能拖挂基础 RAG
      return {
        graphReasoningTrace: [
          ...(state.graphReasoningTrace ?? []),
          {
            knowledgeId: '*',
            matchedEntities: [],
            expandedChunkIds: [],
            expandedChunkCount: 0,
            skipped: true,
            error: error instanceof Error ? error.message : String(error),
          },
        ],
      } satisfies Partial<RagGraphState>;
    }
  };
}

function currentQueryText(state: RagGraphState): string {
  return state.currentQuery || state.question || '';
}

function extractGraphEntitySearchTerms(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const terms = new Set<string>();
  // 优先较长中文/英文短语，过滤过短噪声
  const matches = normalized.match(/[\u4e00-\u9fa5]{2,16}|[A-Za-z][A-Za-z0-9_-]{1,31}/g) ?? [];
  // 按长度降序，先保留更可能是实体的词
  const sorted = [...matches].sort((a, b) => b.length - a.length);
  for (const item of sorted) {
    const term = item.trim();
    if (term.length < 2) continue;
    // 跳过常见功能词
    if (GRAPH_STOP_TERMS.has(term.toLowerCase()) || GRAPH_STOP_TERMS.has(term)) {
      continue;
    }
    terms.add(term);
    if (terms.size >= 5) break;
  }
  return Array.from(terms);
}

const GRAPH_STOP_TERMS = new Set([
  '什么',
  '怎么',
  '如何',
  '为什么',
  '哪些',
  '是否',
  '可以',
  '需要',
  '相关',
  '问题',
  '关系',
  '说明',
  '内容',
  'the',
  'and',
  'for',
  'with',
]);
