import { DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG } from '@/common/constants';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import { RerankerService } from '@/knowledge/services/retrieval/reranker.service';
import { publishCitations, toWorkflowCitations } from '../../rag.utils';

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
      DEFAULT_KNOWLEDGE_RETRIEVAL_CONFIG.rerankLimit,
      input.signal,
    );

    publishCitations(
      input,
      toWorkflowCitations({
        documents: state.documents,
        topDocuments,
        evidenceChunks: topDocuments,
        webCitations: state.webCitations,
      }),
    );

    return {
      topDocuments,
      evidenceChunks: topDocuments,
    } satisfies Partial<RagGraphState>;
  };
}
