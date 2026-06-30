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

    // 如果没有启用图谱或者检索策略里没有开启 useGraph，直接跳过
    if (!graphService.isEnabled() || !state.retrievalStrategy.useGraph) {
      return {};
    }

    try {
      // 1. 获取现有召回的 Top 3 chunks 作为提取实体的分析材料
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

      const expandedChunks: KnowledgeChunk[] = [];

      for (const kbId of kbIds) {
        // 获取该知识库的前 50 个图谱实体
        const entities = await graphService.listEntities(kbId, '', 50);
        // 匹配出现过的实体名称
        const matchedEntities = entities.filter((ent) =>
          ent.name && docContents.toLowerCase().includes(ent.name.toLowerCase()),
        );

        // 最多对 3 个实体进行一跳邻近节点推理，避免关系爆炸
        for (const ent of matchedEntities.slice(0, 3)) {
          const neighborChunks = await graphService.getNeighborhood(kbId, ent.key);
          for (const row of neighborChunks) {
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
              matched_queries: [],
            });
          }
        }
      }

      if (expandedChunks.length === 0) return {};

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
      } satisfies Partial<RagGraphState>;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      // 容错返回空，图谱失败不能拖挂基础 RAG
      return {};
    }
  };
}
