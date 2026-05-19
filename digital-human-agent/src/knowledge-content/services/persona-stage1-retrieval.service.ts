import { Injectable, Logger } from '@nestjs/common';
import { isAbortError, throwIfAborted } from '@/common/utils';
import { normalizeRetrievalStrategy } from '@/common/rag';
import {
  mergeStage1Results,
} from '@/knowledge-content/services/knowledge-retrieval-fusion';
import {
  KnowledgeStage1RetrievalService,
  type KnowledgeStage1RetrievalResult,
} from '@/knowledge-content/services/knowledge-stage1-retrieval.service';
import { PersonaKnowledgeConfigService } from '@/knowledge-content/services/persona-knowledge-config.service';
import { KnowledgeContentRuntimeService } from '@/knowledge-content/services/knowledge-content-runtime.service';
import type {
  KnowledgeChunk,
  RetrievalQueryItem,
  RetrieveKnowledgeTraceItem,
} from '@/knowledge-content/types/knowledge-content.types';

export interface PersonaStage1RetrievalChannels {
  useVector: boolean;
  useKeyword: boolean;
  useGraph: boolean;
  useExactPhrase: boolean;
}

export interface PersonaStage1RetrievalInput {
  personaId: string;
  retrievalQueries: RetrievalQueryItem[];
  stage1TopK?: number;
  threshold?: number;
  channels: PersonaStage1RetrievalChannels;
  signal?: AbortSignal;
}

export interface PersonaStage1RetrievalResult {
  knowledgeCount: number;
  chunks: KnowledgeChunk[];
  trace: RetrieveKnowledgeTraceItem[];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    }),
  );

  return results;
}

@Injectable()
export class PersonaStage1RetrievalService {
  private readonly logger = new Logger(PersonaStage1RetrievalService.name);

  constructor(
    private readonly runtime: KnowledgeContentRuntimeService,
    private readonly personaKnowledgeConfigService: PersonaKnowledgeConfigService,
    private readonly stage1RetrievalService: KnowledgeStage1RetrievalService,
  ) {}

  async retrieve(
    input: PersonaStage1RetrievalInput,
  ): Promise<PersonaStage1RetrievalResult> {
    throwIfAborted(input.signal);

    if (input.retrievalQueries.length === 0) {
      return {
        knowledgeCount: 0,
        chunks: [],
        trace: [],
      };
    }

    const knowledgeConfigs =
      await this.personaKnowledgeConfigService.listMountedKnowledgeConfigs(
        input.personaId,
      );
    throwIfAborted(input.signal);

    if (knowledgeConfigs.length === 0) {
      return {
        knowledgeCount: 0,
        chunks: [],
        trace: [],
      };
    }

    const strategy = normalizeRetrievalStrategy({
      needRetrieval: true,
      useVector: input.channels.useVector,
      useKeyword: input.channels.useKeyword,
      useGraph: input.channels.useGraph,
      useExactPhrase: input.channels.useExactPhrase,
      useMultiQuery: input.retrievalQueries.length > 1,
      allowWeb: false,
      queryCount: input.retrievalQueries.length,
      chunkContextWindow: 0,
      reason: 'persona stage1 检索',
    });

    const stage1Results = await mapWithConcurrency(
      knowledgeConfigs,
      this.resolveConcurrency(),
      async (config) => {
        try {
          throwIfAborted(input.signal);

          const effectiveThreshold =
            input.threshold === undefined
              ? config.threshold
              : this.runtime.toBoundedNumber(input.threshold, config.threshold, 0, 1);
          const effectiveStage1TopK =
            input.stage1TopK === undefined
              ? config.stage1TopK
              : this.runtime.toBoundedNumber(input.stage1TopK, config.stage1TopK, 1, 50);

          const result = await this.stage1RetrievalService.retrieveForKnowledge({
            knowledgeId: config.knowledgeId,
            retrievalQueries: input.retrievalQueries,
            strategy,
            threshold: effectiveThreshold,
            globalStage1TopK: effectiveStage1TopK,
            signal: input.signal,
          });
          throwIfAborted(input.signal);
          return result;
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          if (this.isTransientRetrievalError(error)) {
            throw error;
          }

          this.logger.warn(
            `persona stage1 失败（knowledge=${config.knowledgeId}）：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return {
            chunks: [] as KnowledgeChunk[],
            trace: [] as RetrieveKnowledgeTraceItem[],
          } satisfies KnowledgeStage1RetrievalResult;
        }
      },
    );

    return {
      knowledgeCount: knowledgeConfigs.length,
      chunks: mergeStage1Results(
        stage1Results.map((result) => result.chunks),
        input.stage1TopK === undefined
          ? Math.max(20, ...knowledgeConfigs.map((config) => config.stage1TopK))
          : this.runtime.toBoundedNumber(input.stage1TopK, 20, 1, 50),
      ),
      trace: stage1Results.flatMap((result) => result.trace),
    };
  }

  private resolveConcurrency(): number {
    return this.runtime.toBoundedNumber(
      process.env.RAG_PERSONA_KB_CONCURRENCY,
      3,
      1,
      8,
    );
  }

  private isTransientRetrievalError(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : '';

    return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|Connection terminated unexpectedly|socket hang up|ECONNREFUSED|too many clients|502|503|504|429|temporary .* failure/i.test(
      message,
    );
  }
}
