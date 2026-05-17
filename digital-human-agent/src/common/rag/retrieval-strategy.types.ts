export interface RetrievalStrategy {
  needRetrieval: boolean;
  useVector: boolean;
  useKeyword: boolean;
  useGraph: boolean;
  useExactPhrase: boolean;
  useMultiQuery: boolean;
  allowWeb: boolean;
  queryCount?: number;
  chunkContextWindow?: number;
  graphMode?: 'neighbors' | 'path';
  graphMaxHops?: number;
  reason: string;
}

export type RagStopReason =
  | ''
  | 'retrieval_skipped'
  | 'single_hop_enough'
  | 'single_hop_insufficient'
  | 'multi_hop_enough'
  | 'multi_hop_insufficient'
  | 'max_hops_reached'
  | 'sub_questions_exhausted'
  | 'web_fallback_disabled'
  | 'web_fallback_empty'
  | 'web_fallback_failed'
  | 'web_fallback_retry'
  | 'web_fallback_enough'
  | 'web_fallback_insufficient';

export interface RagEvidenceAssessmentContext {
  enough: boolean | null;
  missingFacts: string[];
  evaluationReason: string;
  stopReason: RagStopReason;
}
