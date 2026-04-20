import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

export interface QueryRewriteMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface QueryRewriteResult {
  originalQuery: string;
  rewrittenQuery: string;
  usedHistory: boolean;
  skippedReason?: string;
}

@Injectable()
export class QueryRewriteService {
  private readonly logger = new Logger(QueryRewriteService.name);

  private readonly llm = new ChatOpenAI({
    model:
      process.env.QUERY_REWRITE_MODEL_NAME ??
      process.env.MODEL_NAME ??
      'qwen-plus',
    temperature: 0,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  async rewrite(
    query: string,
    history: QueryRewriteMessage[] = [],
  ): Promise<QueryRewriteResult> {
    const originalQuery = query.trim();
    const usefulHistory = history
      .filter((item) => item.content.trim())
      .slice(-6);

    if (!originalQuery) {
      return {
        originalQuery,
        rewrittenQuery: originalQuery,
        usedHistory: false,
        skippedReason: 'empty_query',
      };
    }

    if (usefulHistory.length === 0) {
      return {
        originalQuery,
        rewrittenQuery: originalQuery,
        usedHistory: false,
        skippedReason: 'no_history',
      };
    }

    try {
      const response = await this.llm.invoke([
        new SystemMessage(
          '你是 RAG 检索问题改写器。请结合最近对话，把用户当前问题改写成一个可独立检索的完整中文问题。只输出改写后的问题，不要解释，不要 Markdown。',
        ),
        ...usefulHistory.map((item) =>
          item.role === 'user'
            ? new HumanMessage(item.content)
            : new AIMessage(item.content),
        ),
        new HumanMessage(`当前问题：${originalQuery}`),
      ]);

      const rewritten = this.extractText(response.content)
        .replace(/^["“]|["”]$/g, '')
        .trim();

      if (!rewritten) {
        return {
          originalQuery,
          rewrittenQuery: originalQuery,
          usedHistory: true,
          skippedReason: 'empty_model_output',
        };
      }

      return {
        originalQuery,
        rewrittenQuery: rewritten.slice(0, 500),
        usedHistory: true,
      };
    } catch (error) {
      this.logger.warn(
        `Query rewrite 失败，回退原问题：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        originalQuery,
        rewrittenQuery: originalQuery,
        usedHistory: usefulHistory.length > 0,
        skippedReason: 'rewrite_failed',
      };
    }
  }

  private extractText(content: unknown): string {
    if (typeof content === 'string') return content.trim();
    if (!Array.isArray(content)) return '';
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      })
      .join('\n')
      .trim();
  }
}
