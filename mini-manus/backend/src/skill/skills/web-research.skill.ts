import { z } from 'zod';
import {
  Skill,
  SkillContext,
  SkillEvent,
} from '@/skill/interfaces/skill.interface';
import { webResearchSynthesisPrompt } from '@/prompts';

const inputSchema = z.object({
  topic: z.string().min(1).describe('Research topic or question'),
  depth: z.number().int().min(1).max(5).default(3).optional(),
});

const outputSchema = z.object({
  findings: z.string(),
  sources: z.array(z.string()),
});

export class WebResearchSkill implements Skill {
  readonly name = 'web_research';
  readonly description =
    'Deep web research: search for the topic, browse top results, and synthesize findings into a structured summary.';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly effect = 'read-only' as const;

  async *execute(
    input: unknown,
    ctx: SkillContext,
  ): AsyncGenerator<SkillEvent> {
    const { topic, depth } = inputSchema.parse(input);
    const maxPages = depth ?? 3;

    if (ctx.signal.aborted) return;

    yield { type: 'progress', message: `开始调研: ${topic}` };

    // Step 1: Search（走缓存，同一关键词同一任务内不重复请求）
    yield {
      type: 'tool_call',
      tool: 'web_search',
      input: { query: topic, max_results: maxPages },
    };
    const searchResult = await ctx.tools.executeWithCache('web_search', {
      query: topic,
      max_results: maxPages,
    });
    yield {
      type: 'tool_result',
      tool: 'web_search',
      output: searchResult.output,
      cached: searchResult.cached ?? false,
      error: searchResult.error ?? null,
      errorCode: searchResult.errorCode ?? null,
    };

    if (ctx.signal.aborted) return;

    // Parse URLs from search results
    const urlMatches = searchResult.output.matchAll(/URL: (https?:\/\/\S+)/g);
    const urls = Array.from(urlMatches, (m) => m[1]).slice(0, maxPages);
    const pageContents: string[] = [];
    const sources: string[] = [];

    // Step 2: Browse top pages（同样走缓存，避免重复抓取）
    for (const url of urls) {
      if (ctx.signal.aborted) return;
      yield {
        type: 'progress',
        message: `正在阅读来源：${url}`,
      };
      yield {
        type: 'tool_call',
        tool: 'fetch_url_as_markdown',
        input: { url },
      };
      const pageResult = await ctx.tools.executeWithCache(
        'fetch_url_as_markdown',
        { url },
      );
      if (pageResult.success) {
        pageContents.push(`--- ${url} ---\n${pageResult.output}`);
        sources.push(url);
      }
      yield {
        type: 'tool_result',
        tool: 'fetch_url_as_markdown',
        output: (pageResult.output || pageResult.error || '').slice(0, 200) + '...',
        cached: pageResult.cached ?? false,
        error: pageResult.error ?? null,
        errorCode: pageResult.errorCode ?? null,
      };
    }

    if (ctx.signal.aborted) return;

    // Step 3: Synthesize
    yield { type: 'progress', message: '正在整合调研内容...' };
    const contextText = pageContents.join('\n\n').slice(0, 8000);
    const chain = webResearchSynthesisPrompt.pipe(ctx.llm);
    const summaryResponse = await chain.invoke({ topic, contextText });

    const rawContent = summaryResponse.content;
    const findings =
      typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent
              .map((c) => (typeof c === 'string' ? c : JSON.stringify(c)))
              .join('')
          : JSON.stringify(rawContent);
    yield { type: 'reasoning', content: findings };

    yield { type: 'result', output: { findings, sources } };
  }
}
