import { DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG } from '@/common/constants';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import { RerankerService } from '@/knowledge-content/services/retrieval/reranker.service';

export function createRerankNode(rerankerService: RerankerService) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    const documents = state.documents;

    if (documents.length === 0) {
      return {
        topDocuments: [],
        evidenceChunks: [],
      } satisfies Partial<RagGraphState>;
    }

    const topDocuments = await rerankerService.rerank(
      state.question,
      documents,
      DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.finalTopK,
      input.signal,
    );

    return {
      topDocuments,
      evidenceChunks: topDocuments,
    } satisfies Partial<RagGraphState>;
  };
}
