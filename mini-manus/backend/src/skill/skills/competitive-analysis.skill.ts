import { z } from 'zod';
import {
  Skill,
  SkillContext,
  SkillEvent,
} from '@/skill/interfaces/skill.interface';
import { competitiveAnalysisPrompt } from '@/prompts';

const inputSchema = z.object({
  topic_a: z.string().min(1).describe('对比对象 A'),
  topic_b: z.string().min(1).describe('对比对象 B'),
  focus: z.string().default('产品定位、能力边界、适用场景与风险').optional(),
  depth: z.number().int().min(1).max(3).default(2).optional(),
});

const outputSchema = z.object({
  report: z.string(),
  sources: z.array(z.string()),
});

export class CompetitiveAnalysisSkill implements Skill {
  readonly name = 'competitive_analysis';
  readonly description =
    '对两个技术、产品或方案做结构化对比分析，适合竞品、框架和方案选择场景。';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly effect = 'read-only' as const;

  async *execute(
    input: unknown,
    ctx: SkillContext,
  ): AsyncGenerator<SkillEvent> {
    const { topic_a, topic_b, focus, depth } = inputSchema.parse(input);
    const pageDepth = depth ?? 2;
    const collectTopicContext = async function* (
      topic: string,
    ): AsyncGenerator<SkillEvent, { context: string; sources: string[] }> {
      yield {
        type: 'tool_call',
        tool: 'web_search',
        input: { query: topic, max_results: pageDepth },
      };
      const searchResult = await ctx.tools.executeWithCache('web_search', {
        query: topic,
        max_results: pageDepth,
      });
      yield {
        type: 'tool_result',
        tool: 'web_search',
        output: searchResult.output || searchResult.error || '',
        cached: searchResult.cached ?? false,
        error: searchResult.error ?? null,
        errorCode: searchResult.errorCode ?? null,
      };

      // 优先用 structuredData 提取 URL，兼容新格式（{answer,results}）和旧格式（Array）
      const structured = searchResult.structuredData as
        | { results?: Array<{ url: string }> }
        | Array<{ url: string }>
        | undefined;
      const resultItems = Array.isArray(structured)
        ? structured
        : ((structured as { results?: Array<{ url: string }> })?.results ?? []);
      const urls = resultItems.length
        ? resultItems.map((r) => r.url).slice(0, pageDepth)
        : Array.from(
            searchResult.output.matchAll(/URL: (https?:\/\/\S+)/g),
            (m) => m[1],
          ).slice(0, pageDepth);

      const contexts: string[] = [];
      const sources: string[] = [];
      for (const url of urls) {
        if (ctx.signal.aborted) break;
        yield {
          type: 'tool_call',
          tool: 'fetch_url_as_markdown',
          input: { url },
        };
        const pageResult = await ctx.tools.executeWithCache(
          'fetch_url_as_markdown',
          { url },
        );
        yield {
          type: 'tool_result',
          tool: 'fetch_url_as_markdown',
          output: (pageResult.output || pageResult.error || '').slice(0, 220),
          cached: pageResult.cached ?? false,
          error: pageResult.error ?? null,
          errorCode: pageResult.errorCode ?? null,
        };
        if (pageResult.success) {
          contexts.push(`--- ${url} ---\n${pageResult.output}`);
          sources.push(url);
        }
      }

      return { context: contexts.join('\n\n').slice(0, 8000), sources };
    };

    yield {
      type: 'progress',
      message: `开始对比 ${topic_a} 与 ${topic_b}`,
    };

    const contextAGenerator = collectTopicContext(topic_a);
    let nextA = await contextAGenerator.next();
    while (!nextA.done) {
      yield nextA.value;
      nextA = await contextAGenerator.next();
    }
    const contextA = nextA.value;

    const contextBGenerator = collectTopicContext(topic_b);
    let nextB = await contextBGenerator.next();
    while (!nextB.done) {
      yield nextB.value;
      nextB = await contextBGenerator.next();
    }
    const contextB = nextB.value;

    if (ctx.signal.aborted) return;

    yield { type: 'progress', message: '正在整理对比结论...' };
    const chain = competitiveAnalysisPrompt.pipe(ctx.llm);
    const response = await chain.invoke({
      topicA: topic_a,
      topicB: topic_b,
      focus: focus ?? '产品定位、能力边界、适用场景与风险',
      contextA: contextA.context || '暂无资料',
      contextB: contextB.context || '暂无资料',
    });

    const report =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    yield { type: 'reasoning', content: report };
    yield {
      type: 'result',
      output: {
        report,
        sources: [...contextA.sources, ...contextB.sources],
      },
    };
  }
}
