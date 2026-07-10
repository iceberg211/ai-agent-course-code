import { Injectable, Optional } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { isAbortError, throwIfAborted } from '@/common/utils';
import type { RagWebCitation } from '@/agent/types/rag-workflow.types';
import type { ConversationMessage } from '@/conversation/entities/conversation-message.entity';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import {
  createDefaultLlmFactoryService,
  LlmFactoryService,
} from '@/common/llm/llm-factory.service';
import {
  AGENT_CHAT_PROMPT,
  DIRECT_CHAT_PROMPT,
  buildAgentPromptInput,
  buildDirectChatPromptInput,
} from '@/common/prompts';
import {
  buildLangSmithRunnableConfig,
  runInTracedScope,
} from '@/common/langsmith/langsmith.utils';
import type { RetrievalStrategy } from '@/common/rag';
import type { RagEvidenceAssessmentContext } from '@/common/rag';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge/types/knowledge-content.types';
import type { Persona } from '@/persona/persona.entity';
import {
  recordFirstTokenBudget,
  tryConsumeLlmBudget,
  addTurnDegradation,
  getTurnBudget,
  withRemainingTurnTimeout,
} from '@/common/rag/turn-budget.context';

export interface GenerateAnswerParams {
  conversationId: string;
  personaId: string;
  turnId: string;
  userMessage: string;
  signal: AbortSignal;
  persona: Persona;
  history: ConversationMessage[];
  localChunks: RetrievedKnowledgeChunk[];
  memoryContext?: string;
  retrievalStrategy?: RetrievalStrategy;
  webCitations?: RagWebCitation[];
  evidenceAssessment?: RagEvidenceAssessmentContext;
  onToken: (token: string) => void;
}

export interface GenerateDirectAnswerParams {
  conversationId: string;
  personaId: string;
  turnId: string;
  userMessage: string;
  signal: AbortSignal;
  onToken: (token: string) => void;
  /** 闲聊路径也保留人设，避免退化成通用助手 */
  persona?: Persona | null;
  history?: ConversationMessage[];
}

@Injectable()
export class AnswerGenerationService {
  private readonly llm: ChatOpenAI;

  constructor(@Optional() llmFactory?: LlmFactoryService) {
    this.llm = (llmFactory ?? createDefaultLlmFactoryService()).createChatModel(
      {
        defaultModel: DEFAULT_LLM_MODEL_NAME,
        streaming: true,
        temperature: 0.7,
      },
    );
  }

  async generate(params: GenerateAnswerParams): Promise<string> {
    return runInTracedScope(
      {
        name: 'rag_generate_answer',
        runType: 'chain',
        tags: ['agent', 'rag', 'generate'],
        metadata: {
          conversationId: params.conversationId,
          personaId: params.personaId,
          turnId: params.turnId,
          citationCount:
            params.localChunks.length + (params.webCitations?.length ?? 0),
        },
        input: {
          conversationId: params.conversationId,
          personaId: params.personaId,
          turnId: params.turnId,
          userMessage: params.userMessage,
          citationCount:
            params.localChunks.length + (params.webCitations?.length ?? 0),
        },
        outputProcessor: (output) => ({
          answerLength: output.length,
        }),
      },
      () => this.generateInternal(params),
    );
  }

  async generateDirect(params: GenerateDirectAnswerParams): Promise<string> {
    return runInTracedScope(
      {
        name: 'rag_generate_direct_answer',
        runType: 'chain',
        tags: ['agent', 'rag', 'generate', 'direct'],
        metadata: {
          conversationId: params.conversationId,
          personaId: params.personaId,
          turnId: params.turnId,
        },
        input: {
          conversationId: params.conversationId,
          personaId: params.personaId,
          turnId: params.turnId,
          userMessage: params.userMessage,
        },
        outputProcessor: (output) => ({
          answerLength: output.length,
        }),
      },
      () => this.generateDirectInternal(params),
    );
  }

  private async generateDirectInternal(
    params: GenerateDirectAnswerParams,
  ): Promise<string> {
    throwIfAborted(params.signal);

    if (!tryConsumeLlmBudget(1)) {
      addTurnDegradation('budget_llm');
      const fallback = '抱歉，当前服务繁忙，请稍后再试。';
      recordFirstTokenBudget();
      params.onToken(fallback);
      return fallback;
    }

    const messages = await DIRECT_CHAT_PROMPT.formatMessages(
      buildDirectChatPromptInput(
        params.userMessage,
        params.persona,
        params.history ?? [],
      ),
    );

    throwIfAborted(params.signal);

    let answerText = '';
    try {
      const stream = await withRemainingTurnTimeout(
        'agent_generate_direct',
        (childSignal) =>
          this.llm.stream(messages, {
            ...buildLangSmithRunnableConfig({
              runName: 'agent_generate_direct',
              tags: ['agent', 'rag', 'generate', 'direct', 'llm'],
              metadata: {
                conversationId: params.conversationId,
                personaId: params.personaId,
                turnId: params.turnId,
              },
            }),
            signal: childSignal,
          }),
        params.signal,
      );
      for await (const chunk of stream) {
        throwIfAborted(params.signal);
        if (getTurnBudget()?.isWallClockExhausted()) {
          addTurnDegradation('generate_wall_clock_truncated');
          break;
        }
        const token = typeof chunk.content === 'string' ? chunk.content : '';
        if (!token) continue;
        if (!answerText) recordFirstTokenBudget();
        answerText += token;
        params.onToken(token);
      }
    } catch (error) {
      if (isAbortError(error) && params.signal.aborted) throw error;
      addTurnDegradation('generate_timeout');
    }

    if (!answerText) {
      const fallback = '抱歉，当前生成超时，请稍后再试。';
      recordFirstTokenBudget();
      params.onToken(fallback);
      return fallback;
    }

    return answerText;
  }

  private async generateInternal(
    params: GenerateAnswerParams,
  ): Promise<string> {
    throwIfAborted(params.signal);

    if (!tryConsumeLlmBudget(1)) {
      addTurnDegradation('budget_llm');
      const fallback = '抱歉，当前检索与生成资源紧张，请稍后再试或简化问题。';
      recordFirstTokenBudget();
      params.onToken(fallback);
      return fallback;
    }

    const messages = await AGENT_CHAT_PROMPT.formatMessages(
      buildAgentPromptInput(
        params.persona,
        params.localChunks,
        params.userMessage,
        params.history,
        {
          webContextBlock: this.formatWebContextBlock(
            params.webCitations ?? [],
          ),
          memoryContextBlock: params.memoryContext,
          evidenceAssessment: params.evidenceAssessment,
        },
      ),
    );

    throwIfAborted(params.signal);

    let answerText = '';
    try {
      const stream = await withRemainingTurnTimeout(
        'agent_generate',
        (childSignal) =>
          this.llm.stream(messages, {
            ...buildLangSmithRunnableConfig({
              runName: 'agent_generate',
              tags: ['agent', 'rag', 'generate', 'llm'],
              metadata: {
                conversationId: params.conversationId,
                personaId: params.personaId,
                turnId: params.turnId,
                citationCount:
                  params.localChunks.length +
                  (params.webCitations?.length ?? 0),
              },
            }),
            signal: childSignal,
          }),
        params.signal,
      );
      for await (const chunk of stream) {
        throwIfAborted(params.signal);
        if (getTurnBudget()?.isWallClockExhausted()) {
          addTurnDegradation('generate_wall_clock_truncated');
          break;
        }
        const token = typeof chunk.content === 'string' ? chunk.content : '';
        if (!token) continue;
        if (!answerText) recordFirstTokenBudget();
        answerText += token;
        params.onToken(token);
      }
    } catch (error) {
      if (isAbortError(error) && params.signal.aborted) throw error;
      addTurnDegradation('generate_timeout');
    }

    if (!answerText) {
      const fallback = '抱歉，当前生成超时，请稍后再试。';
      recordFirstTokenBudget();
      params.onToken(fallback);
      return fallback;
    }

    return answerText;
  }

  private formatWebContextBlock(webCitations: RagWebCitation[]): string {
    if (webCitations.length === 0) {
      return '';
    }

    return webCitations
      .map(
        (item, index) =>
          `[网页 ${index + 1}]
标题：${item.title}
URL：${item.url}
网站：${item.siteName ?? '未知'}
时间：${item.publishedAt ?? '未知'}
摘要：${item.snippet}`,
      )
      .join('\n\n');
  }
}
