import { Injectable } from '@nestjs/common';
import { throwIfAborted } from '@/agent/agent.utils';
import {
  toNeo4jKnowledgeChunk,
  type Neo4jGraphRetrieveRow,
} from '@/knowledge-content/graph/neo4j-graph-chunk.mapper';
import {
  buildNeo4jGraphRetrieveQuery,
  buildNeo4jGraphSearchTerms,
  normalizeNeo4jGraphMaxHops,
} from '@/knowledge-content/graph/neo4j-graph-retriever-query.builder';
import { Neo4jGraphService } from '@/knowledge-content/graph/neo4j-graph.service';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

export interface Neo4jGraphRetrieveParams {
  knowledgeId: string;
  retrievalQuery: string;
  keywordTerms: string[];
  matchCount: number;
  graphMode?: 'neighbors' | 'path';
  graphMaxHops?: number;
  signal?: AbortSignal;
}

@Injectable()
export class Neo4jGraphRetrieverService {
  constructor(private readonly neo4jGraphService: Neo4jGraphService) {}

  isEnabled(): boolean {
    return this.neo4jGraphService.isEnabled();
  }

  async retrieve(params: Neo4jGraphRetrieveParams): Promise<KnowledgeChunk[]> {
    if (!this.isEnabled()) return [];

    throwIfAborted(params.signal);
    const terms = buildNeo4jGraphSearchTerms(
      params.keywordTerms,
      params.retrievalQuery,
    );
    if (terms.length === 0) return [];
    const maxHops = normalizeNeo4jGraphMaxHops(params.graphMaxHops);

    const rows = await this.neo4jGraphService.query<Neo4jGraphRetrieveRow>(
      buildNeo4jGraphRetrieveQuery(params.graphMode, maxHops),
      {
        knowledgeId: params.knowledgeId,
        terms,
        matchCount: Math.max(1, Math.trunc(params.matchCount)),
        maxHops,
      },
    );
    throwIfAborted(params.signal);

    return rows.map(toNeo4jKnowledgeChunk);
  }
}
