import { QueryAugmentationService } from '@/agent/services/query/query-augmentation.service';
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
} from '@/agent/langgraph/rag.utils';
import { HybridRetrieverService } from '@/knowledge/services/retrieval/channels/hybrid-retriever.service';

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
