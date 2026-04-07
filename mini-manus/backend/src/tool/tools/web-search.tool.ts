import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { z } from 'zod';
import { Tool, ToolResult, truncateOutput } from '../interfaces/tool.interface';

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

  constructor(private readonly config: ConfigService) {}

  async execute(input: unknown): Promise<ToolResult> {
    const parsed = schema.parse(input);
    const apiKey = this.config.get<string>('TAVILY_API_KEY', '');

    if (!apiKey) {
      return {
        success: false,
        output: '',
        error: 'TAVILY_API_KEY not configured',
      };
    }

    try {
      const response = await axios.post(
        'https://api.tavily.com/search',
        { query: parsed.query, max_results: parsed.max_results ?? 5 },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 },
      );

      const responseData = response.data as {
        results?: Array<{ title: string; url: string; content: string }>;
      };
      const results = responseData.results ?? [];
      const output = results
        .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
        .join('\n\n');

      return { success: true, output: truncateOutput(output || '无结果') };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `Search failed: ${msg}` };
    }
  }
}
