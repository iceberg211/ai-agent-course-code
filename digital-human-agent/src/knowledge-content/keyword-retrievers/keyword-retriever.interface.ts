import type {
  KnowledgeChunk,
  KeywordBackend,
} from '@/knowledge-content/types/knowledge-content.types';

export interface KeywordRetrieveParams {
  knowledgeId: string;
  terms: string[];
  matchCount: number;
  useExactPhrase?: boolean;
}

export interface KeywordRetriever {
  retrieveChunks(params: KeywordRetrieveParams): Promise<KnowledgeChunk[]>;
}

export interface KeywordRetrieveResult {
  chunks: KnowledgeChunk[];
  backend: KeywordBackend;
  fallbackToPg: boolean;
}
