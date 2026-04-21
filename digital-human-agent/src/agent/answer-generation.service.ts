import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { throwIfAborted } from '@/agent/agent.utils';
import type { ConversationMessage } from '@/conversation/conversation-message.entity';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import { AGENT_CHAT_PROMPT, buildAgentPromptInput } from '@/common/prompts';
import {
  buildLangSmithRunnableConfig,
  runInTracedScope,
} from '@/common/langsmith/langsmith.utils';
import type { KnowledgeChunk as RetrievedKnowledgeChunk } from '@/knowledge-content/types/knowledge-content.types';
import type { Persona } from '@/persona/persona.entity';

export interface GenerateAnswerParams {
  conversationId: string;
  personaId: string;
  turnId: string;
  userMessage: string;
  signal: AbortSignal;
  persona: Persona;
  history: ConversationMessage[];
  chunks: RetrievedKnowledgeChunk[];
  onToken: (token: string) => void;
}

@Injectable()
export class AnswerGenerationService {
  private readonly llm = new ChatOpenAI({
    model: process.env.MODEL_NAME ?? DEFAULT_LLM_MODEL_NAME,
    streaming: true,
    temperature: 0.7,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

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
          citationCount: params.chunks.length,
        },
        input: {
          conversationId: params.conversationId,
          personaId: params.personaId,
          turnId: params.turnId,
          userMessage: params.userMessage,
          citationCount: params.chunks.length,
        },
        outputProcessor: (output) => ({
          answerLength: output.length,
        }),
      },
      () => this.generateInternal(params),
    );
  }

  private async generateInternal(params: GenerateAnswerParams): Promise<string> {
    throwIfAborted(params.signal);

    const messages = await AGENT_CHAT_PROMPT.formatMessages(
      buildAgentPromptInput(
        params.persona,
        params.chunks,
        params.userMessage,
        params.history,
      ),
    );

    throwIfAborted(params.signal);

    const stream = await this.llm.stream(messages, {
      ...buildLangSmithRunnableConfig({
        runName: 'agent_generate',
        tags: ['agent', 'rag', 'generate', 'llm'],
        metadata: {
          conversationId: params.conversationId,
          personaId: params.personaId,
          turnId: params.turnId,
          citationCount: params.chunks.length,
        },
      }),
      signal: params.signal,
    });

    let answerText = '';
    for await (const chunk of stream) {
      throwIfAborted(params.signal);
      const token = typeof chunk.content === 'string' ? chunk.content : '';
      if (!token) continue;
      answerText += token;
      params.onToken(token);
    }

    return answerText;
  }
}
