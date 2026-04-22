import { Command } from '@langchain/langgraph';
import type { WebFallbackService } from '@/agent/services/web-fallback.service';
import type { KnowledgeSearchService } from '@/knowledge-content/services/knowledge-search.service';
import {
  ensureWorkflowNotAborted,
  type RagGraphConfig,
} from '@/agent/langgraph/rag.context';
import type { RagGraphState } from '@/agent/langgraph/rag.state';
import {
  getNextQuery,
  getPlannedQuestions,
  mergeEvidenceChunks,
  publishCitations,
  shouldUseWebFallback,
  toWorkflowCitations,
} from '@/agent/langgraph/rag.utils';

function shouldRetrieve(state: RagGraphState): boolean {
  const nextQuery = getNextQuery(state);
  if (!nextQuery) {
    return false;
  }

  if (state.strategy === 'simple') {
    return true;
  }

  return (
    state.currentHop < state.maxHops &&
    state.currentHop < getPlannedQuestions(state).length
  );
}

export function createPrepareQueryNode(webFallbackService: WebFallbackService) {
  return (state: RagGraphState) => {
    const plannedQuestions = getPlannedQuestions(state);

    if (state.strategy === 'simple') {
      return new Command({
        goto: 'retrieve_evidence',
      });
    }

    const webFallbackEnabled = webFallbackService.isEnabled();
    let stopReason = state.stopReason;

    if (state.currentHop >= state.maxHops) {
      stopReason = webFallbackEnabled
        ? 'max_hops_reached'
        : 'web_fallback_disabled';
    } else if (state.currentHop >= plannedQuestions.length) {
      stopReason = webFallbackEnabled
        ? 'sub_questions_exhausted'
        : 'web_fallback_disabled';
    }

    const update = {
      stopReason,
    } satisfies Partial<RagGraphState>;

    if (shouldRetrieve(state)) {
      return new Command({
        update,
        goto: 'retrieve_evidence',
      });
    }

    if (shouldUseWebFallback(state, webFallbackEnabled)) {
      return new Command({
        update,
        goto: 'web_fallback',
      });
    }

    return new Command({
      update,
      goto: 'load_context',
    });
  };
}

export function createRetrieveEvidenceNode(
  knowledgeSearchService: KnowledgeSearchService,
) {
  return async (state: RagGraphState, config: RagGraphConfig) => {
    const input = ensureWorkflowNotAborted(config);
    const query = getNextQuery(state);
    if (!query) {
      return {};
    }

    const chunks = await knowledgeSearchService.retrieveForPersona(
      input.personaId,
      query,
    );

    const evidenceChunks = mergeEvidenceChunks(state.evidenceChunks, chunks);
    publishCitations(
      input,
      toWorkflowCitations({
        evidenceChunks,
        webCitations: state.webCitations,
      } as Pick<RagGraphState, 'evidenceChunks' | 'webCitations'>),
    );

    return {
      currentHop: state.currentHop + 1,
      evidenceChunks,
      retrievalHistory: [
        ...state.retrievalHistory,
        {
          query,
          resultCount: chunks.length,
        },
      ],
    } satisfies Partial<RagGraphState>;
  };
}
