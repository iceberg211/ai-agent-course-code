import { z } from 'zod';
import { Skill, SkillContext, SkillEvent } from '@/skill/interfaces/skill.interface';

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

    // Step 1: Search
    const searchTool = ctx.tools.get('web_search');
    yield {
      type: 'tool_call',
      tool: 'web_search',
      input: { query: topic, max_results: maxPages },
    };
    const searchResult = await searchTool.execute({
      query: topic,
      max_results: maxPages,
    });
    yield {
      type: 'tool_result',
      tool: 'web_search',
      output: searchResult.output,
    };

    if (ctx.signal.aborted) return;

    // Parse URLs from search results
    const urlMatches = searchResult.output.matchAll(/URL: (https?:\/\/\S+)/g);
    const urls = Array.from(urlMatches, (m) => m[1]).slice(0, maxPages);
    const pageContents: string[] = [];
    const sources: string[] = [];

    // Step 2: Browse top pages
    const browseTool = ctx.tools.get('browse_url');
    for (const url of urls) {
      if (ctx.signal.aborted) return;
      yield { type: 'tool_call', tool: 'browse_url', input: { url } };
      const pageResult = await browseTool.execute({ url });
      if (pageResult.success) {
        pageContents.push(`--- ${url} ---\n${pageResult.output}`);
        sources.push(url);
      }
      yield {
        type: 'tool_result',
        tool: 'browse_url',
        output: pageResult.output.slice(0, 200) + '...',
      };
    }

    if (ctx.signal.aborted) return;

    // Step 3: Synthesize
    yield { type: 'progress', message: '正在整合调研内容...' };
    const contextText = pageContents.join('\n\n').slice(0, 8000);
    const summaryResponse = await ctx.llm.invoke([
      {
        role: 'system',
        content:
          '你是一个专业的研究助手。根据提供的网页内容，整合出一份关于该主题的结构化摘要。用中文回答，条理清晰。',
      },
      {
        role: 'user',
        content: `研究主题：${topic}\n\n参考内容：\n${contextText}\n\n请整合成结构化摘要：`,
      },
    ]);

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
