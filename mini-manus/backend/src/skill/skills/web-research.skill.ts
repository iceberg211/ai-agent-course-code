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

    // Parse URLs from search results — 优先用 structuredData，降级时用正则
    type SearchStructured = {
      answer?: string | null;
      results?: Array<{ title: string; url: string; snippet: string }>;
    };
    const structured = searchResult.structuredData as
      | SearchStructured
      | Array<{ url: string }> // 兼容旧格式
      | undefined;

    // 兼容新格式（{answer, results}）和旧格式（Array）
    const resultItems: Array<{
      title?: string;
      url: string;
      snippet?: string;
    }> = Array.isArray(structured)
      ? structured
      : ((structured as SearchStructured)?.results ?? []);
    const tavilyAnswer: string | null =
      (structured as SearchStructured)?.answer ?? null;

    const urls: string[] = resultItems
      .map((r) => r.url)
      .filter(Boolean)
      .slice(0, maxPages);

    // 无 URL 时降级正则
    if (urls.length === 0) {
      urls.push(
        ...Array.from(
          searchResult.output.matchAll(/URL: (https?:\/\/\S+)/g),
          (m) => m[1],
        ).slice(0, maxPages),
      );
    }
    // 质量门控：结果不足时尝试扩展关键词重试一次
    if (urls.length < 2 && !tavilyAnswer && !ctx.signal.aborted) {
      yield {
        type: 'progress',
        message: `搜索结果不足（${urls.length} 条），正在尝试扩展关键词…`,
      };
      const fallbackQuery = `${topic} 最新进展 综述`;
      yield {
        type: 'tool_call',
        tool: 'web_search',
        input: { query: fallbackQuery, max_results: maxPages },
      };
      const fallback = await ctx.tools.executeWithCache('web_search', {
        query: fallbackQuery,
        max_results: maxPages,
      });
      yield {
        type: 'tool_result',
        tool: 'web_search',
        output: fallback.output,
        cached: fallback.cached ?? false,
        error: fallback.error ?? null,
        errorCode: fallback.errorCode ?? null,
      };
      const fbStructured = fallback.structuredData as
        | SearchStructured
        | Array<{ url: string }>
        | undefined;
      const fbItems: Array<{ url: string }> = Array.isArray(fbStructured)
        ? fbStructured
        : ((fbStructured as SearchStructured)?.results ?? []);
      const fbUrls = fbItems.length
        ? fbItems.map((r) => r.url)
        : Array.from(
            fallback.output.matchAll(/URL: (https?:\/\/\S+)/g),
            (m) => m[1],
          );
      urls.push(
        ...fbUrls
          .filter((u) => !urls.includes(u))
          .slice(0, maxPages - urls.length),
      );
    }

    // Tavily 直接答案：质量足够好时可以跳过页面抓取，直接综合
    if (tavilyAnswer && urls.length === 0) {
      yield {
        type: 'progress',
        message: 'Tavily 已提供直接答案，跳过页面抓取',
      };
      yield {
        type: 'result',
        output: {
          findings: tavilyAnswer,
          sources: resultItems.map((r) => r.url).filter(Boolean),
        },
      };
      return;
    }

    // 最终无结果：提前返回有意义的结论，不做空综合
    if (urls.length === 0) {
      yield {
        type: 'result',
        output: {
          findings: `未找到关于"${topic}"的有效搜索结果。建议使用更具体的关键词重新描述任务。`,
          sources: [],
        },
      };
      return;
    }

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
      const snippet = resultItems.find((r) => r.url === url)?.snippet ?? '';
      if (pageResult.success) {
        pageContents.push(`--- ${url} ---\n${pageResult.output}`);
        sources.push(url);
      } else if (snippet) {
        // fetch 失败时 fallback 到 Tavily snippet，保证 synthesis 有内容
        pageContents.push(`--- ${url} ---\n${snippet}`);
        sources.push(url);
      }
      yield {
        type: 'tool_result',
        tool: 'fetch_url_as_markdown',
        output:
          (pageResult.output || pageResult.error || '').slice(0, 200) + '...',
        cached: pageResult.cached ?? false,
        error: pageResult.error ?? null,
        errorCode: pageResult.errorCode ?? null,
      };
    }

    if (ctx.signal.aborted) return;

    // Step 3: Synthesize
    yield { type: 'progress', message: '正在整合调研内容...' };
    // 将 Tavily answer 拼在最前面，作为最高优先级参考
    const answerPrefix = tavilyAnswer
      ? `## Tavily 直接回答\n${tavilyAnswer}\n\n## 来源页面\n`
      : '';
    const contextText =
      (answerPrefix + pageContents.join('\n\n')).slice(0, 8000);
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
