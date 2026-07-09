import { Injectable, Logger } from '@nestjs/common';
import { HybridRetrieverService } from '@/knowledge/services/retrieval/channels/hybrid-retriever.service';
import { GraphExpandService } from '@/knowledge/services/retrieval/pipeline/graph-expand.service';
import type {
  RetrievalPort,
  RetrievalPortRequest,
  RetrievalPortResponse,
} from '@/knowledge/services/retrieval/pipeline/retrieval-port';
import { mergeHybridResults } from '@/knowledge/services/retrieval/channels/knowledge-retrieval-fusion';

/**
 * 统一检索端口实现：Hybrid 多路召回 + 可选 Graph 一跳 expand。
 * 由 KnowledgeSearch / Agent 共用，避免平行第二套流水线。
 *
 * 注意：rewrite / rerank / stageTrace 仍可由上层按场景组合
 *（Search 在 KnowledgeSearchService；Agent 在 LangGraph 节点）。
 */
@Injectable()
export class RetrievalPipelineService implements RetrievalPort {
  private readonly logger = new Logger(RetrievalPipelineService.name);

  constructor(
    private readonly hybridRetriever: HybridRetrieverService,
    private readonly graphExpandService: GraphExpandService,
  ) {}

  async retrieve(
    request: RetrievalPortRequest,
  ): Promise<RetrievalPortResponse> {
    const hybrid = await this.hybridRetriever.retrieveForPersona({
      personaId: request.personaId,
      retrievalQueries: request.retrievalQueries,
      strategy: request.strategy,
      accessScope: request.accessScope,
      signal: request.signal,
    });

    if (!request.graphExpand) {
      return {
        chunks: hybrid.chunks,
        trace: hybrid.trace,
        knowledgeCount: hybrid.knowledgeCount,
        rerankLimit: hybrid.rerankLimit,
        graphExpandTrace: [
          {
            knowledgeId: '*',
            matchedEntities: [],
            expandedChunkIds: [],
            expandedChunkCount: 0,
            skipped: true,
            reason: 'graphExpand=false',
          },
        ],
      };
    }

    const expand = await this.graphExpandService.expand({
      documents: hybrid.chunks,
      question: request.question ?? request.retrievalQueries[0]?.query ?? '',
      currentQuery: request.currentQuery,
      useGraphChannel: request.strategy.useGraph === true,
      graphExpand: true,
      accessScope: request.accessScope,
      signal: request.signal,
    });

    const chunks =
      expand.expandedChunks.length > 0
        ? mergeHybridResults(
            [hybrid.chunks, expand.expandedChunks],
            Math.max(hybrid.chunks.length + expand.expandedChunks.length, 20),
          )
        : hybrid.chunks;

    if (expand.expandedChunks.length > 0) {
      this.logger.debug(
        `Graph expand 合并 ${expand.expandedChunks.length} 条邻居证据`,
      );
    }

    return {
      chunks,
      trace: hybrid.trace,
      knowledgeCount: hybrid.knowledgeCount,
      rerankLimit: hybrid.rerankLimit,
      graphExpandTrace: expand.trace,
    };
  }
}
