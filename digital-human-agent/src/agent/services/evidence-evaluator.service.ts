import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { throwIfAborted } from '@/agent/agent.utils';
import type {
  RagEvidenceEvaluation,
  RagWebCitation,
} from '@/agent/types/rag-workflow.types';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import {
  buildLangSmithRunnableConfig,
  runInTracedScope,
} from '@/common/langsmith/langsmith.utils';
import {
  buildRagEvidenceEvaluatorPromptInput,
  RAG_EVIDENCE_EVALUATOR_PROMPT,
} from '@/common/prompts';
import type { KnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';

const RagEvidenceEvaluationSchema = z.object({
  enough: z.boolean(),
  missingFacts: z.array(z.string().min(1).max(120)).max(6),
  reason: z.string().min(1).max(200),
  webQuery: z.string().max(300).optional().default(''),
});

interface EvaluateEvidenceParams {
  question: string;
  localChunks: KnowledgeChunk[];
  webCitations?: RagWebCitation[];
  currentHop: number;
  maxHops: number;
  remainingSubQuestionCount: number;
  signal?: AbortSignal;
}

@Injectable()
export class EvidenceEvaluatorService {
  private readonly logger = new Logger(EvidenceEvaluatorService.name);

  private readonly llm = new ChatOpenAI({
    model:
      process.env.EVIDENCE_EVALUATOR_MODEL_NAME ??
      process.env.MODEL_NAME ??
      DEFAULT_LLM_MODEL_NAME,
    temperature: 0,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  async evaluate(
    params: EvaluateEvidenceParams,
  ): Promise<RagEvidenceEvaluation> {
    const normalizedQuestion = params.question.trim();
    if (!normalizedQuestion) {
      return {
        enough: false,
        missingFacts: ['用户问题为空'],
        reason: '无法评估空问题',
        webQuery: '',
      };
    }

    return runInTracedScope(
      {
        name: 'rag_evidence_evaluate',
        runType: 'chain',
        tags: ['agent', 'rag', 'evaluate'],
        metadata: {
          questionLength: normalizedQuestion.length,
          localChunkCount: params.localChunks.length,
          webCitationCount: params.webCitations?.length ?? 0,
          currentHop: params.currentHop,
          maxHops: params.maxHops,
          remainingSubQuestionCount: params.remainingSubQuestionCount,
        },
        input: {
          question: normalizedQuestion,
        },
        outputProcessor: (output) => ({
          enough: output.enough,
          missingFactCount: output.missingFacts.length,
          reason: output.reason,
          webQuery: output.webQuery,
        }),
      },
      async () => {
        throwIfAborted(params.signal);

        try {
          const evaluator = this.llm.withStructuredOutput(
            RagEvidenceEvaluationSchema,
          );
          const result = await evaluator.invoke(
            await RAG_EVIDENCE_EVALUATOR_PROMPT.formatMessages(
              buildRagEvidenceEvaluatorPromptInput({
                question: normalizedQuestion,
                currentHop: params.currentHop,
                maxHops: params.maxHops,
                remainingSubQuestionCount: params.remainingSubQuestionCount,
                localEvidenceBlock: this.formatLocalEvidence(
                  params.localChunks,
                ),
                webEvidenceBlock: this.formatWebEvidence(
                  params.webCitations ?? [],
                ),
              }),
            ),
            {
              ...buildLangSmithRunnableConfig({
                runName: 'rag_evidence_evaluate_llm',
                tags: ['agent', 'rag', 'evaluate', 'llm'],
                metadata: {
                  question: normalizedQuestion,
                },
              }),
              signal: params.signal,
            },
          );

          return {
            enough: result.enough,
            missingFacts: this.normalizeMissingFacts(result.missingFacts),
            reason: result.reason.trim() || '证据评估完成',
            webQuery: String(result.webQuery ?? '').trim(),
          } satisfies RagEvidenceEvaluation;
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError') {
            throw error;
          }

          this.logger.warn(
            `证据评估失败，回退启发式判断：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return this.buildFallbackEvaluation(params);
        }
      },
    );
  }

  private formatLocalEvidence(chunks: KnowledgeChunk[]): string {
    if (chunks.length === 0) {
      return '（暂无本地证据）';
    }

    return chunks
      .slice(0, 8)
      .map(
        (chunk, index) =>
          `[本地证据 ${index + 1}] 来源=${chunk.source} 段落=${chunk.chunk_index}\n${chunk.content.slice(0, 300)}`,
      )
      .join('\n\n');
  }

  private formatWebEvidence(webCitations: RagWebCitation[]): string {
    if (webCitations.length === 0) {
      return '（暂无联网补充）';
    }

    return webCitations
      .slice(0, 6)
      .map(
        (item, index) =>
          `[联网证据 ${index + 1}] 标题=${item.title}\nURL=${item.url}\n摘要=${item.snippet.slice(0, 300)}`,
      )
      .join('\n\n');
  }

  private normalizeMissingFacts(missingFacts: string[]): string[] {
    return Array.from(
      new Set(
        missingFacts
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
    ).slice(0, 6);
  }

  private buildFallbackEvaluation(
    params: EvaluateEvidenceParams,
  ): RagEvidenceEvaluation {
    const enough =
      params.localChunks.length >= 3 || (params.webCitations?.length ?? 0) >= 1;

    return {
      enough,
      missingFacts: enough ? [] : ['当前证据可能不足以覆盖完整答案'],
      reason: enough ? '启发式判断证据基本足够' : '启发式判断证据仍不足',
      webQuery:
        (params.webCitations?.length ?? 0) > 0 ? '' : params.question.trim(),
    };
  }
}
