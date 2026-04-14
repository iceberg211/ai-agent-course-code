/**
 * web_research 子图（Subgraph-as-Node 模式）
 *
 * 将 5 次搜索 + 3 次抓取 + LLM 综合封装为独立子图，
 * 主图只接收最终 findings，中间产物不污染主图 state 也不累积到 LLM 上下文。
 *
 * 关键 LangGraph.js API：
 * - `compile({ checkpointer: false })`: 子图不需要 interrupt，关闭 checkpoint 避免开销和命名空间冲突
 * - 用 wrapper async function 做 state 映射，不依赖 TypeScript LangGraph.js 不支持的 input/output 变换
 */

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { ToolRegistry } from '@/tool/tool.registry';
import { webResearchSynthesisPrompt } from '@/prompts';

// ─── 子图独立 State ───────────────────────────────────────────────────────────

const ResearchState = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, b) => b }),
  depth: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 3,
  }),
  urls: Annotation<string[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  // 用 append reducer 收集多个页面内容
  pageContents: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  findings: Annotation<string>({
    reducer: (_, b) => b,
    default: () => '',
  }),
  sources: Annotation<string[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
});

export type ResearchSubgraphOutput = {
  findings: string;
  sources: string[];
};

// ─── 子图构建函数 ─────────────────────────────────────────────────────────────

/**
 * 构建 web_research 子图。
 *
 * @param llm      共享主图的 ChatOpenAI 实例
 * @param toolRegistry  工具注册表（search / fetch）
 * @param signal   取消信号（每次 Run 独立，因此子图也需要每次 Run 构建）
 */
export function buildResearchSubgraph(
  llm: ChatOpenAI,
  toolRegistry: ToolRegistry,
  signal: AbortSignal,
) {
  return new StateGraph(ResearchState)
    // ── 节点 1：搜索 ──────────────────────────────────────────────────────────
    .addNode('search', async (state) => {
      const result = await toolRegistry.executeWithCache('web_search', {
        query: state.topic,
        max_results: state.depth,
      });
      // 优先使用 structuredData，兼容新格式（{answer,results}）和旧格式（Array）
      const structured = result.structuredData as
        | { results?: Array<{ url: string }> }
        | Array<{ url: string }>
        | undefined;
      const resultItems = Array.isArray(structured)
        ? structured
        : ((structured as { results?: Array<{ url: string }> })?.results ?? []);
      const urls = resultItems.length
        ? resultItems.map((r) => r.url).slice(0, state.depth)
        : Array.from(
            result.output.matchAll(/URL: (https?:\/\/\S+)/g),
            (m) => m[1],
          ).slice(0, state.depth);
      return { urls };
    })
    // ── 节点 2：批量抓取 ──────────────────────────────────────────────────────
    .addNode('fetch', async (state) => {
      const contents: string[] = [];
      const srcs: string[] = [];
      for (const url of state.urls) {
        if (signal.aborted) break;
        const r = await toolRegistry.executeWithCache('fetch_url_as_markdown', {
          url,
        });
        if (r.success) {
          contents.push(`--- ${url} ---\n${r.output.slice(0, 3000)}`);
          srcs.push(url);
        }
      }
      return { pageContents: contents, sources: srcs };
    })
    // ── 节点 3：LLM 综合 ──────────────────────────────────────────────────────
    .addNode('synthesize', async (state) => {
      if (state.pageContents.length === 0) {
        return {
          findings: `未找到关于"${state.topic}"的有效内容，建议使用更具体的关键词重新描述任务。`,
        };
      }
      const contextText = state.pageContents.join('\n\n').slice(0, 8000);
      const chain = webResearchSynthesisPrompt.pipe(llm);
      const resp = await chain.invoke(
        { topic: state.topic, contextText },
        { signal },
      );
      const findings =
        typeof resp.content === 'string'
          ? resp.content
          : JSON.stringify(resp.content);
      return { findings };
    })
    .addEdge(START, 'search')
    .addEdge('search', 'fetch')
    .addEdge('fetch', 'synthesize')
    .addEdge('synthesize', END)
    // checkpointer: false — 子图不需要 interrupt，关闭 checkpoint 避免开销
    .compile({ checkpointer: false });
}
