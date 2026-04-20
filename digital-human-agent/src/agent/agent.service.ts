import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from '@langchain/core/messages';
import {
  KnowledgeContentService,
  KnowledgeChunk as RetrievedKnowledgeChunk,
} from '@/knowledge-content/knowledge-content.service';
import { ConversationMessage } from '@/conversation/conversation-message.entity';
import { ConversationService } from '@/conversation/conversation.service';
import { Persona } from '@/persona/persona.entity';
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
    model: process.env.MODEL_NAME ?? 'qwen-plus',
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
    const messages = this.buildMessages(persona, chunks, history, userMessage);

    // 5. 流式生成
    const stream = await this.llm.stream(messages, { signal });

    for await (const chunk of stream) {
      if (signal.aborted) break;
      const token = typeof chunk.content === 'string' ? chunk.content : '';
      if (token) onToken(token);
    }
  }

  private buildMessages(
    persona: Persona,
    chunks: RetrievedKnowledgeChunk[],
    history: ConversationMessage[],
    userMessage: string,
  ) {
    const knowledgeBlock =
      chunks.length > 0
        ? chunks
            .map(
              (c) => `[来源: ${c.source}, 段落 ${c.chunk_index}]\n${c.content}`,
            )
            .join('\n---\n')
        : '（知识库中未找到相关内容）';

    const systemPrompt = `你是${persona.name}。${persona.description ?? ''}
你的说话风格：${persona.speakingStyle ?? '自然、友善'}
你的专业领域：${(persona.expertise ?? []).join('、')}

以下是与当前问题相关的知识（按相关性排列）：
---
${knowledgeBlock}
---

要求：
1. 始终以${persona.name}的身份回答
2. 回答必须基于上述知识，不要编造不在知识库中的内容
3. 如果知识库中没有相关信息，诚实说"这个我不太清楚"
4. 语气和用词要符合角色人设
5. 回答要口语化，适合语音朗读（避免长列表、代码块、复杂格式）
6. 回答时自然地提及信息来源，例如"根据文档里的说明..."${persona.systemPromptExtra ? '\n' + persona.systemPromptExtra : ''}`;

    const messages: (SystemMessage | HumanMessage | AIMessage)[] = [
      new SystemMessage(systemPrompt),
    ];

    // 历史对话（只有 completed 的）
    for (const msg of history) {
      if (msg.role === 'user') {
        messages.push(new HumanMessage(msg.content));
      } else {
        messages.push(new AIMessage(msg.content));
      }
    }

    messages.push(new HumanMessage(userMessage));
    return messages;
  }
}
