import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { z } from 'zod';
import {
  Tool,
  ToolResult,
  truncateOutput,
} from '@/tool/interfaces/tool.interface';
import { classifyToolError, toolFailure } from '@/tool/utils/tool-error';

const schema = z.object({
  query: z.string().min(1).describe('Search query'),
  max_results: z.number().int().min(1).max(10).default(5).optional(),
});

@Injectable()
export class WebSearchTool implements Tool {
  readonly name = 'web_search';
  readonly description =
    'Search the web for information. Returns titles, URLs, and snippets.';
  readonly schema = schema;
  readonly type = 'read-only' as const;
  readonly requires = ['tavily_api'] as const;

  constructor(private readonly config: ConfigService) {}

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const parsed = schema.parse(input);
      const apiKey = this.config.get<string>('TAVILY_API_KEY', '');

      if (!apiKey) {
        return toolFailure(
          'tool_execution_failed',
          'TAVILY_API_KEY not configured',
        );
      }

      const response = await axios.post(
        'https://api.tavily.com/search',
        {
          query: parsed.query,
          max_results: parsed.max_results ?? 5,
          include_answer: true, // Tavily 直接返回 AI 合成答案，作为首要参考
        },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 },
      );

      const responseData = response.data as {
        results?: Array<{ title: string; url: string; content: string }>;
        answer?: string;
      };
      const results = responseData.results ?? [];

      // answer 字段优先展示，供 LLM 直接参考，质量通常高于原始 snippet
      const answerBlock = responseData.answer
        ? `直接回答：${responseData.answer}\n\n来源：\n`
        : '';
      const output =
        answerBlock +
        results
          .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
          .join('\n\n');

      return {
        success: true,
        output: truncateOutput(output || '无结果'),
        // 结构化数据：Skill 直接用此字段提取 URL/snippet，不必正则解析 output
        structuredData: {
          answer: responseData.answer ?? null,
          results: results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
          })),
        },
      };
    } catch (err: unknown) {
      return classifyToolError(err, 'Search failed');
    }
  }
}
