import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { AGENT_CHAT_PROMPT, buildAgentPromptInput } from '@/common/prompts';
import { DEFAULT_LLM_MODEL_NAME } from '@/common/constants';
import {
  KnowledgeContentService,
  KnowledgeChunk as RetrievedKnowledgeChunk,
} from '@/knowledge-content/services/knowledge-content.service';
import { ConversationService } from '@/conversation/conversation.service';
import { PersonaService } from '@/persona/persona.service';

export interface RunAgentParams {
  conversationId: string;
  personaId: string;
  userMessage: string;
  turnId: string;
  signal: AbortSignal;
  onToken: (token: string) => void;
  onCitations: (citations: RetrievedKnowledgeChunk[]) => void;
}

@Injectable()
export class AgentService {
  private readonly llm = new ChatOpenAI({
    model: process.env.MODEL_NAME ?? DEFAULT_LLM_MODEL_NAME,
    streaming: true,
    temperature: 0.7,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  constructor(
    private readonly knowledgeContentService: KnowledgeContentService,
    private readonly personaService: PersonaService,
    private readonly conversationService: ConversationService,
  ) {}

  async run(params: RunAgentParams): Promise<void> {
    const {
      conversationId,
      personaId,
      userMessage,
      signal,
      onToken,
      onCitations,
    } = params;

    // 1. retrieve (persona 聚合：挂载的所有 KB 并查 + 合并 + 全局 rerank)
    const chunks: RetrievedKnowledgeChunk[] =
      await this.knowledgeContentService.retrieveForPersona(
        personaId,
        userMessage,
      );

    // 2. 推送引用来源
    if (chunks.length > 0) onCitations(chunks);

    // 3. 加载 persona 和历史
    const [persona, history] = await Promise.all([
      this.personaService.findOne(personaId),
      this.conversationService.getCompletedMessages(conversationId, 10),
    ]);

    // 4. 构建 messages
    const messages = await AGENT_CHAT_PROMPT.formatMessages(
      buildAgentPromptInput(persona, chunks, userMessage, history),
    );

    // 5. 流式生成
    const stream = await this.llm.stream(messages, { signal });

    for await (const chunk of stream) {
      if (signal.aborted) break;
      const token = typeof chunk.content === 'string' ? chunk.content : '';
      if (token) onToken(token);
    }
  }
}
