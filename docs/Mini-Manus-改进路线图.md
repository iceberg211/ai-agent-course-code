# Mini-Manus 改进路线图

> 基于 `docs/问题.md` 13 个维度，映射到 LangGraph.js / LangChain.js 具体 API。
> 功能架构优先；安全、可观测性、工程质量留后续专项。
> 已使用 `langgraph-fundamentals`、`langgraph-persistence`、`nestjs-best-practices` skill 核验所有 API 用法。

---

## 0. 已完成项

| 编号 | 改进 | 关键 API | 状态 |
|------|------|----------|------|
| P0-1 | Tool `structuredData` + `requires` 依赖声明 | `ToolResult.structuredData`, `ToolRequirement` | ✅ |
| P0-2 | Executor `.steps/` 宽带数据持久化 | `fs/promises`, `workspace.resolveSafePath` | ✅ |
| P0-3 | LangGraph Store 跨 Run 记忆 | `InMemoryStore`, `getStore(config)`, `store.put/search` | ✅ |
| P1-4 | Planner 工具可用性过滤 | `toolRegistry.getAvailableForPlanner()` | ✅ |
| P2-1 | Evaluator 决策追踪事件 | `EVALUATOR_DECIDED` event, `EventPublisher` | ✅ |
| P2-3 | Token 预算感知规划 | `usedTokens`/`tokenBudget` Annotation, `budgetHint` | ✅ |

---

## 1. 问题映射总览

| 维度 | 核心问题 | 框架解法 | 本轮优先级 |
|------|----------|----------|------------|
| 一、上下文管理 | stepResults 硬截断；evaluator 固定 3 步窗口 | 动态上下文窗口 + 智能截断 | **P0** |
| 十三、数据流 | Skill 输出没有写 .steps/；宽带窄带分离不完整 | persistStepOutput 补齐 Skill 路径 | **P0** |
| 八、工具层 | 多数工具无 structuredData；URL 提取依赖正则 | 补齐 structuredData；统一 URL 提取 | **P0** |
| 九、Skill | SkillContext 太薄；无质量门控；空结果仍综合 | 丰富 SkillContext；Skill 内质量检查 | **P1** |
| 五、提示词 | toolCallingPrompt 只两行；缺参数选择规则 | 增强 Tool Calling 系统提示 | **P1** |
| 七、沙箱 | 代码执行失败直接 replan 整个任务 | `code_fix` Skill + Planner INTENT_GUIDANCE | **P1** |
| 四、意图识别 | 5 类太粗；code_generation 涵盖差异巨大的子类型 | Router 增加 `subType` 二级字段 | **P1** |
| 二、规划 | 硬编码/LLM 二元对立；无中间层 | WorkflowTemplate 参数化中间层 | **P1** |
| 三、SubAgent | Skill 内联污染主图；无并行 | subgraph-as-node + `Send` fan-out | **P2** |
| 六、其他 | 无降级策略；Store 只记结果不记反思 | evaluator 降级分支；finalizer 反思写入 | **P2** |
| 十、安全 | Guardrail 只覆盖 Planner | *后续专项* | defer |
| 十一、可观测性 | 无 trace 串联；无完整 prompt 记录 | *后续专项* | defer |
| 十二、工程质量 | 无 Agent 行为测试；Skill 无测试 | *后续专项* | defer |

---

## 阶段一（P0）：打通信息通道

### 1.1 Evaluator 动态上下文窗口

**改动目标**
用按信息价值动态裁剪替换硬编码 `.slice(-3)` 和 `lastStepOutput.slice(0, 1000)`，保证 LLM 始终看到最相关的上下文，不因固定窗口丢失关键步骤。

**影响模块**
- `src/agent/nodes/evaluator.node.ts`：`applyDecision`（`newStepResult.toolOutput` 截断逻辑）+ `evaluatorNode`（`recentSummaries` 构建）

**不影响模块**
- `agent.state.ts`（`StepResult` 结构不变）
- `executor.node.ts`、`planner.node.ts`（不读 recentSummaries）
- 数据库 schema、EventPublisher（不涉及）

**关键链路影响**
`executor → evaluator`：evaluator 传给 LLM 的上下文质量提升，决策准确性提高；`evaluator → state.stepResults`：写入的 `toolOutput` 从硬切变为结构化摘要+指针。

**风险点**
- `smartTruncate` 的正则匹配可能在某些工具输出中误判重要内容；降级 fallback（头尾保留）可作为保底。
- 动态窗口逻辑变复杂，需保证空 stepResults 时不出错。

**验证方式**
1. 单测：`evaluator.node.spec.ts` 补充 `buildRecentSummaries` 的边界测试（空数组、长输出、含 URL 输出）
2. 功能验证：运行一个 3+ 步骤的 research_report 任务，观察 evaluator 收到的 `recentSummaries` 不再丢失 URL

```typescript
// evaluator.node.ts — 新增 buildRecentSummaries helper（替换现有 .slice(-3)）

function buildRecentSummaries(
  stepResults: StepResult[],
  maxChars = 3000,
): string {
  if (stepResults.length === 0) return '暂无';
  const current = stepResults[stepResults.length - 1];
  let result = `[当前] ${current.description}: ${current.toolOutput ?? current.resultSummary}`;
  let remaining = maxChars - result.length;
  for (let i = stepResults.length - 2; i >= 0 && remaining > 200; i--) {
    const s = stepResults[i];
    const line = `[步骤${s.executionOrder + 1}] ${s.description}: ${(s.toolOutput ?? s.resultSummary).slice(0, 300)}`;
    if (line.length > remaining) break;
    result = line + '\n' + result;
    remaining -= line.length;
  }
  return result;
}

// evaluator.node.ts — applyDecision 中 newStepResult 构建（替换 .slice(0, 1000)）

function smartTruncate(output: string, limit = 1500): string {
  if (output.length <= limit) return output;
  // 优先保留 URL、状态行、编号列表
  const important = output.split('\n').filter(line =>
    /https?:\/\//.test(line) ||
    /error|fail|成功|完成/.test(line.toLowerCase()) ||
    /^\d+\./.test(line.trim()),
  );
  if (important.length > 0) {
    const summary = important.join('\n').slice(0, limit - 60);
    return summary + `\n[完整输出见 .steps/ 目录，共 ${output.length} 字符]`;
  }
  const head = output.slice(0, Math.floor(limit * 0.75));
  const tail = output.slice(-Math.floor(limit * 0.15));
  return `${head}\n...[省略 ${output.length - limit} 字符]...\n${tail}`;
}
```

---

### 1.2 Skill 输出写入 .steps/（persistStepOutput 补齐）

**改动目标**
executor 的 Skill 路径目前只传了 `outputStr`，没有传 `skillOutput`（结构化数据）给 `persistStepOutput`。补齐后，Skill 的结构化产物（如 `{ files, entry_file }`）也会写到 `.steps/` 文件，下游 Tool Calling 可通过 `read_file` 读取完整数据。

**影响模块**
- `src/agent/nodes/executor.node.ts`：Skill 成功路径中的 `persistStepOutput` 调用

**不影响模块**
- `persistStepOutput` 函数本身（签名已支持 `structuredData` 参数）
- 所有 Skill 实现（Skill 不感知持久化）
- 数据库、状态机、EventPublisher

**关键链路影响**
`executor skill 路径`：写到磁盘的 `.steps/` 文件从只有文本变为同时包含结构化数据，Tool Calling prompt 中的文件指针指向更完整的数据。

**风险点**
- 极低：`persistStepOutput` 已有 `try/catch`，写入失败不阻断主流程。
- `skillOutput` 可能很大（code_project_generation 输出文件内容），但已通过 `JSON.stringify` 序列化，磁盘空间消耗可接受。

**验证方式**
1. 运行 code_generation 任务，检查 `.steps/step_0_code_project_generation.json` 中是否包含 `structuredData.files` 和 `structuredData.entry_file`
2. 已有测试不破坏（`pnpm test`）

```typescript
// executor.node.ts — Skill 成功路径（约 line 440 附近）

// 之前：
await persistStepOutput(workspace, taskId, executionOrder, skillName, description, outputStr);

// 之后（传入 skillOutput 作为 structuredData）：
await persistStepOutput(workspace, taskId, executionOrder, skillName, description, outputStr, skillOutput);
```

---

### 1.3 补齐高频工具的 structuredData

**改动目标**
`fetch_url_as_markdown` 和 `github_search` 目前只返回文本 `output`，没有 `structuredData`。Skill 和 Tool Calling 需要通过正则解析文本来提取 URL、仓库信息等，容易出错。补齐结构化数据后，下游可以直接读取字段，不需要正则。

**影响模块**
- `src/tool/tools/fetch-url-as-markdown.tool.ts`
- `src/tool/tools/github-search.tool.ts`

**不影响模块**
- `tool.interface.ts`（`structuredData` 字段已存在，可选）
- 所有 Skill（改为优先读 structuredData，降级到文本解析，行为等价）
- 数据库 schema、状态机

**关键链路影响**
`web_research` / `competitive_analysis` Skill 内的 URL 提取从脆弱正则变为直接字段访问；Tool Calling 的 `.steps/` 文件包含结构化 URL 列表，LLM 参数生成更准确。

**风险点**
- `extractTitle(markdown)` 需要稳健实现，避免空 markdown 时抛错。
- `github_search` 的 `items` 格式依赖 GitHub API 响应，需处理 API 返回异常的情况。

**验证方式**
1. 单测：mock `web_search` 返回 `structuredData`，验证 `web_research.skill.ts` 使用它而非正则
2. 单测：mock `fetch_url_as_markdown` 返回 `structuredData`，验证下游能读取 `title`
3. `pnpm test` 全量通过

```typescript
// fetch-url-as-markdown.tool.ts — execute() 返回值

function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)/m);
  return match?.[1]?.slice(0, 120) ?? '';
}

return {
  success: true,
  output: truncateOutput(markdown),
  structuredData: {
    url: (input as { url: string }).url,
    title: extractTitle(markdown),
    contentLength: markdown.length,
  },
};

// github-search.tool.ts — execute() 返回值

return {
  success: true,
  output: truncateOutput(formatted),
  structuredData: items.map((item: any) => ({
    name: item.full_name as string,
    url: item.html_url as string,
    description: (item.description as string) ?? '',
    stars: item.stargazers_count as number,
  })),
};
```

---

### 1.4 competitive-analysis.skill.ts 统一使用 structuredData

**改动目标**
`competitive-analysis.skill.ts:56-59` 还在用 `URL: (https?://\S+)` 正则提取 URL，与 `web-research.skill.ts` 改进前相同的脆弱模式。统一改用 `structuredData` 优先，正则降级，保持与 web-research 一致。

**影响模块**
- `src/skill/skills/competitive-analysis.skill.ts`：`collectTopicContext` 中的 URL 解析

**不影响模块**
- 其他所有 Skill 和 Tool
- 数据库、状态机、EventPublisher

**关键链路影响**
`competitive_analysis` Skill 执行路径：URL 提取更可靠，减少因正则失配导致的空抓取。

**风险点**
极低：逻辑等价替换，structuredData 不存在时自动降级到正则，行为不退化。

**验证方式**
1. 代码审查：确认 `collectTopicContext` 中的解析逻辑与 `web-research.skill.ts` 一致
2. `pnpm test` 通过

```typescript
// competitive-analysis.skill.ts — collectTopicContext 中（约 line 56）

// 之前：
const urls = Array.from(
  searchResult.output.matchAll(/URL: (https?:\/\/\S+)/g),
  (match) => match[1],
).slice(0, pageDepth);

// 之后（与 web-research.skill.ts 保持一致）：
const structured = searchResult.structuredData as Array<{ url: string }> | undefined;
const urls = structured
  ? structured.map((r) => r.url).slice(0, pageDepth)
  : Array.from(
      searchResult.output.matchAll(/URL: (https?:\/\/\S+)/g),
      (m) => m[1],
    ).slice(0, pageDepth);
```

---

## 阶段二（P1）：规划灵活性与 Skill 能力增强

### 2.1 SkillContext 增强

**改动目标**
SkillContext 缺少"当前任务是什么"和"我还有多少预算"两个关键信息，导致 Skill 无法根据上下文调整行为（如预算紧张时减少搜索深度）。在不破坏任何现有 Skill 的前提下，新增可选字段。

**影响模块**
- `src/skill/interfaces/skill.interface.ts`：`SkillContext` 接口新增字段（可选，不破坏现有实现）
- `src/agent/nodes/executor.node.ts`：构建 `SkillContext` 时注入新字段

**不影响模块**
- 所有已有 Skill（新字段可选，不需要修改）
- 数据库、EventPublisher、路由逻辑

**关键链路影响**
executor → Skill 调用：SkillContext 更丰富，Skill 内部可以据此做决策；不影响 executor 的主控流程。

**风险点**
- 新字段均为可选（`?`），已有 Skill 不需要修改，向后兼容。
- `remainingBudgetHint` 是粗估值，Skill 只应用于"大方向调整"（如 depth），不应精确控制。

**验证方式**
1. TypeScript 编译通过（`tsc --noEmit`）
2. 新字段注入：在 executor 的单测中验证 SkillContext 构建时包含新字段

```typescript
// skill.interface.ts — 扩展 SkillContext（所有新增字段为可选）

export interface SkillContext {
  tools: ToolRegistry;
  llm: ChatOpenAI;
  workspace: WorkspaceService;
  signal: AbortSignal;
  soMethod: 'functionCalling' | 'json_schema' | 'jsonMode';
  // ── 新增可选字段 ──
  taskId?: string;
  priorStepSummaries?: string[];   // 前序步骤的简短描述列表
  remainingBudgetHint?: number;    // 粗估剩余 token 数（usedTokens → tokenBudget 区间）
}

// executor.node.ts — 构建 SkillContext 时注入
const skillCtx: SkillContext = {
  tools: toolRegistry,
  llm,
  workspace,
  signal,
  soMethod,
  taskId: state.taskId,
  priorStepSummaries: state.stepResults.map(s => s.description),
  remainingBudgetHint: state.tokenBudget - state.usedTokens,
};
```

---

### 2.2 Skill 质量门控（web_research 空结果保护）

**改动目标**
`web_research` 搜索结果为 0 条 URL 时，直接用空内容让 LLM 综合，输出"暂无相关信息"的无用结果。增加质量门控：搜索结果不足 2 条时自动换关键词重试一次；最终仍无结果时提前 yield 有意义的错误，不做空综合。

**影响模块**
- `src/skill/skills/web-research.skill.ts`：Step 1（搜索）与 Step 3（综合）之间新增检查逻辑

**不影响模块**
- `competitive-analysis.skill.ts`（有相同问题，但 scope 单独处理）
- 所有 Tool 和 executor 逻辑
- 数据库、状态机

**关键链路影响**
`web_research` Skill 执行路径：空结果时不再浪费 LLM token 做无意义综合；最多多一次 `web_search` 工具调用（带宽/成本可接受）。

**风险点**
- 扩展关键词（加"最新进展 综述"后缀）可能引入不相关内容，但总比空结果好。
- 重试逻辑增加了 Skill 复杂度，需注意 `ctx.signal.aborted` 检查不遗漏。

**验证方式**
1. 新建 `web-research.skill.spec.ts`，mock `web_search` 返回空结果，验证触发重试
2. mock 两次搜索均为空，验证 `yield { type: 'result', output: { findings: '未找到...', sources: [] } }` 而非调用 LLM

```typescript
// web-research.skill.ts — Step 1 结束后插入质量检查

// ... 搜索完成，urls 已解析 ...

// 质量门控：结果不足时尝试扩展关键词
if (urls.length < 2 && !ctx.signal.aborted) {
  yield { type: 'progress', message: `搜索结果不足（${urls.length} 条），正在尝试扩展关键词…` };
  const fallback = await ctx.tools.executeWithCache('web_search', {
    query: `${topic} 最新进展 综述`,
    max_results: maxPages,
  });
  yield { type: 'tool_result', tool: 'web_search', output: fallback.output,
    cached: fallback.cached ?? false, error: fallback.error ?? null, errorCode: fallback.errorCode ?? null };
  const fbStructured = fallback.structuredData as Array<{ url: string }> | undefined;
  const fbUrls = fbStructured
    ? fbStructured.map(r => r.url)
    : Array.from(fallback.output.matchAll(/URL: (https?:\/\/\S+)/g), m => m[1]);
  urls.push(...fbUrls.filter(u => !urls.includes(u)).slice(0, maxPages - urls.length));
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
```

---

### 2.3 增强 Tool Calling 系统提示

**改动目标**
`toolCallingPrompt` 当前系统提示只有两行（"根据步骤目标调用工具，必须调用工具"），缺少参数选择规则，LLM 经常编造 URL 或使用错误的 task_id。增加明确的参数来源优先级、常见错误处理规则。

**影响模块**
- `src/prompts/index.ts`：`toolCallingPrompt` 的 system message

**不影响模块**
- executor.node.ts 中 Tool Calling 的调用方式（不变）
- 所有 Tool、Skill、数据库

**关键链路影响**
executor Tool Calling 路径：LLM 生成工具参数的质量提升，减少因参数错误导致的 retry；不改变调用链结构。

**风险点**
- 系统提示变长会消耗更多 token（约增加 150 tokens/次调用），可接受。
- 规则过多可能反而干扰 LLM 决策；保持规则数 ≤6 条、语言简洁。

**验证方式**
1. 运行 research_report 任务，观察 Tool Calling 生成的 `fetch_url_as_markdown` 参数是否来自实际搜索结果（而非编造的 URL）
2. `pnpm test` 通过（prompt 变更不影响单测）

```typescript
// prompts/index.ts — toolCallingPrompt system message 替换

export const toolCallingPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个工具调用助手。根据步骤目标和前序步骤的执行结果，调用指定工具并填入正确参数。

规则（按优先级）：
1. 必须调用工具，不要只回复文字
2. 参数来源：前序步骤的真实输出 > 步骤描述中的线索 > 合理推断
3. URL 参数：只使用前序步骤中出现的真实 URL，不要编造
4. task_id 参数：始终使用当前任务的 task_id，不要修改
5. 如果有 retryHint（前次失败原因），换不同的参数重试

提示：前序步骤的完整输出在 .steps/step_{序号}_{工具名}.json，可通过 read_file 读取；下方摘要通常已足够。`,
  ],
  [
    'human',
    `任务目标：{revisionInput}
当前步骤：{stepDescription}

前序步骤结果：
{stepContext}{retryHint}`,
  ],
]);
```

---

### 2.4 代码修复闭环（code_fix Skill）

**改动目标**
沙箱执行失败（`code_execution_failed`）后，evaluator 触发 `replan`，Planner 重新规划时应该选择"修复代码"而不是"重新生成整个项目"。新增 `code_fix` Skill，并在 `INTENT_GUIDANCE` 中指导 Planner 复用它。

**影响模块**
- `src/skill/skills/code-fix.skill.ts`（新增，遵循 `arch-single-responsibility`）
- `src/skill/skill.module.ts`：注册 `CodeFixSkill`
- `src/prompts/index.ts`：`INTENT_GUIDANCE.code_generation` 追加修复指引

**不影响模块**
- `code-project-generation.skill.ts`（生成逻辑不变）
- `evaluator.node.ts`（`code_execution_failed → replan` 逻辑不变）
- 数据库 schema、状态机、EventPublisher

**关键链路影响**
`replan` 路径：Planner 在 `replanCount > 0 && 前次有 code_execution_failed` 时，生成一个"code_fix → sandbox_run_node"两步计划，而非重新生成整个项目，token 消耗降低 ~70%。

**风险点**
- code_fix 依赖 LLM 准确定位 bug，复杂错误（缺依赖、运行时环境问题）可能修不了；但比重新生成失败代价低。
- Planner 需要正确识别"有前次 code_execution_failed"的 replan 场景，依赖 `completedContext` 携带足够信息。

**验证方式**
1. 新建 `code-fix.skill.spec.ts`，mock `list_directory` + `read_file` + LLM，验证 Skill 能生成修复后的文件
2. 集成测试：运行一个有语法错误的代码生成任务，验证 replan 后选择 code_fix 而非重新生成

```typescript
// skill/skills/code-fix.skill.ts — 新增（遵循 arch-single-responsibility）

import { z } from 'zod';
import { Skill, SkillContext, SkillEvent } from '@/skill/interfaces/skill.interface';
import { ChatPromptTemplate } from '@langchain/core/prompts';

const inputSchema = z.object({
  task_id: z.string().uuid(),
  error_output: z.string().describe('沙箱运行的错误输出（stderr + exitCode）'),
  project_dir: z.string().default('project').optional(),
});

const codeFix Prompt = ChatPromptTemplate.fromMessages([
  ['system', `你是一个代码调试助手。根据错误信息和项目代码，输出需要修改的文件内容。
输出格式与代码生成相同：每个文件以 ---FILE: 路径 开头，下面是完整的修复后内容。
只输出需要修改的文件，不要输出不需要变动的文件。`],
  ['human', `错误信息：\n{errorOutput}\n\n项目文件列表：\n{fileList}\n\n关键文件内容：\n{fileContents}\n\n请输出修复后的文件：`],
]);

export class CodeFixSkill implements Skill {
  readonly name = 'code_fix';
  readonly description = '根据沙箱运行错误修复代码文件，用于代码执行失败后的 replan 步骤。';
  readonly inputSchema = inputSchema;
  readonly outputSchema = z.object({ fixedFiles: z.array(z.string()), file_count: z.number() });
  readonly effect = 'side-effect' as const;

  async *execute(input: unknown, ctx: SkillContext): AsyncGenerator<SkillEvent> {
    const { task_id, error_output, project_dir } = inputSchema.parse(input);
    const rootDir = project_dir ?? 'project';

    yield { type: 'progress', message: '正在读取项目结构…' };

    // 1. 读取文件列表
    yield { type: 'tool_call', tool: 'list_directory', input: { task_id, path: rootDir } };
    const listResult = await ctx.tools.executeWithCache('list_directory', { task_id, path: rootDir });
    yield { type: 'tool_result', tool: 'list_directory', output: listResult.output,
      cached: listResult.cached ?? false, error: listResult.error ?? null, errorCode: listResult.errorCode ?? null };

    // 2. 读取关键文件（package.json + 入口文件，最多 3 个）
    const KEY_FILES = ['package.json', 'index.js', 'index.ts', 'src/index.js', 'src/index.ts'];
    const fileContents: string[] = [];
    for (const f of KEY_FILES) {
      if (ctx.signal.aborted) break;
      const filePath = `${rootDir}/${f}`;
      yield { type: 'tool_call', tool: 'read_file', input: { task_id, path: filePath } };
      const readResult = await ctx.tools.executeWithCache('read_file', { task_id, path: filePath });
      yield { type: 'tool_result', tool: 'read_file', output: readResult.output.slice(0, 300),
        cached: readResult.cached ?? false, error: readResult.error ?? null, errorCode: readResult.errorCode ?? null };
      if (readResult.success) fileContents.push(`--- ${filePath} ---\n${readResult.output}`);
    }

    if (ctx.signal.aborted) return;

    // 3. LLM 生成修复 patch
    yield { type: 'progress', message: '正在分析错误并生成修复方案…' };
    const chain = codeFixPrompt.pipe(ctx.llm);
    const response = await chain.invoke({
      errorOutput: error_output.slice(0, 2000),
      fileList: listResult.output.slice(0, 500),
      fileContents: fileContents.join('\n\n').slice(0, 4000),
    }, { signal: ctx.signal });

    if (ctx.signal.aborted) throw new Error('cancelled');

    const rawContent = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    // 4. 解析并写入修复后的文件（复用 parseFileBlocks 逻辑）
    const FILE_SEPARATOR = '---FILE:';
    const parts = rawContent.split(new RegExp(`^${FILE_SEPARATOR}\\s*`, 'm'));
    const fixedFiles: string[] = [];

    for (const part of parts) {
      if (!part.trim() || ctx.signal.aborted) continue;
      const nl = part.indexOf('\n');
      if (nl === -1) continue;
      const filePath = `${rootDir}/${part.slice(0, nl).trim().replace(/['"]/g, '')}`;
      const content = part.slice(nl + 1).replace(/^```[\w-]*\n/i, '').replace(/\n```\s*$/i, '').trimEnd();
      if (!content) continue;

      yield { type: 'tool_call', tool: 'write_file', input: { task_id, path: filePath, content } };
      const writeResult = await ctx.tools.executeWithCache('write_file', { task_id, path: filePath, content });
      yield { type: 'tool_result', tool: 'write_file', output: writeResult.output,
        cached: writeResult.cached ?? false, error: writeResult.error ?? null, errorCode: writeResult.errorCode ?? null };
      if (!writeResult.success) throw new Error(writeResult.error ?? `写入 ${filePath} 失败`);
      fixedFiles.push(filePath);
    }

    yield { type: 'result', output: { fixedFiles, file_count: fixedFiles.length } };
  }
}

// prompts/index.ts — INTENT_GUIDANCE.code_generation 追加
`【代码修复策略】
如果 completedContext 中出现 code_execution_failed 错误，说明是代码执行失败后的重规划：
- 必须使用 code_fix skill（不要重新生成整个项目）
- code_fix 的 error_output 字段填入前序步骤中的错误输出
- 修复后再加一步 sandbox_run_node 验证`
```

---

### 2.5 意图识别增强（subType 二级字段）

**改动目标**
Router 只输出 5 个粗粒度意图，`code_generation` 同时覆盖了 web app、CLI 工具、数据脚本、API 服务。增加 `subType` 二级字段，不改变主流程，让 Planner 的 `INTENT_GUIDANCE` 可以做更精细的策略选择。

**影响模块**
- `src/agent/nodes/router.node.ts`：`IntentSchema` + `routerPrompt` 增加 `subType`
- `src/agent/agent.state.ts`：`AgentStateAnnotation` 新增 `taskIntentSubType`
- `src/agent/agent.service.ts`：router wrapper 不变（state 自动带新字段）

**不影响模块**
- `planner.node.ts`（可选读取，不强制依赖）
- 所有 Tool、Skill、数据库 schema

**关键链路影响**
`router → planner`：state 中多了 `taskIntentSubType` 字段，Planner 构建 toolSection 时可按 subType 调整示例；现有流程不受影响。

**风险点**
- LLM 可能输出不在示例列表中的 subType，Planner 需要容错（不认识的 subType 忽略即可）。
- `AgentStateAnnotation` 新增字段需同步更新所有 `mockState` 函数，防止测试 TypeScript 编译报错。

**验证方式**
1. `pnpm test`：更新所有 spec 文件中的 `mockState`，补上 `taskIntentSubType: ''`
2. 功能验证：运行 code_generation 任务，日志中看到 `subType: web_app` 或 `cli_tool` 等

```typescript
// router.node.ts — 新增 subType

const IntentSchema = z.object({
  intent: z.enum(VALID_INTENTS as [TaskIntent, ...TaskIntent[]]),
  subType: z.string().describe(
    '更细化的子类型。code_generation 填: web_app / cli_tool / data_script / api_server / other；'
    + 'research_report 填: technical_analysis / market_research / tutorial / other；'
    + '其他意图填 other',
  ),
  reason: z.string(),
});

// 返回值中传回 subType：
return { taskIntent: intent, taskIntentSubType: result.subType ?? '' };

// agent.state.ts — 新增字段
taskIntentSubType: Annotation<string>({
  reducer: (_, b) => b,
  default: () => '',
}),
```

---

### 2.6 WorkflowTemplate 参数化中间层

**改动目标**
当前规划只有"完全硬编码"（`DETERMINISTIC_WORKFLOWS`）和"完全 LLM"两种选择。引入 `WorkflowTemplate` 中间层：步骤骨架固定，动态参数由一次轻量 LLM 调用填充（比完整规划便宜 ~60%），扩展性好（新意图只需写 skeleton）。

**影响模块**
- `src/agent/nodes/planner.node.ts`：新增 `WorkflowTemplate` 接口、`WORKFLOW_TEMPLATES`、`fillTemplateParams` 函数；在 `plannerNode` 中增加模板路径

**不影响模块**
- `DETERMINISTIC_WORKFLOWS`（保留，作为"已知最优"的快速路径）
- 所有 Tool、Skill、executor、evaluator

**关键链路影响**
`router → planner`：对有模板的意图（`competitive_analysis`、`content_writing`），走模板路径而非完整 LLM 规划；`research_report`（目前 DETERMINISTIC）可迁移到模板路径，支持参数化的深度/标题。

**风险点**
- `fillTemplateParams` 的参数 schema 需精心设计，避免 LLM 填入占位符或无效值。
- 首次引入时建议只迁移 1 个意图（`competitive_analysis`），验证稳定后再扩展。

**验证方式**
1. 单测：mock LLM 返回参数，验证 `fillTemplateParams` 正确组装 `PlanStepDef[]`
2. 功能验证：运行 competitive_analysis 任务，观察 Planner 日志走模板路径，生成的参数（`topic_a`/`topic_b`）来自用户输入

```typescript
// planner.node.ts — WorkflowTemplate 结构

interface TemplateStepSkeleton {
  description: string;
  skillName?: string;
  toolHint?: string;
  dynamicParams: string[];           // LLM 需要填充的参数名列表
  staticParams: Record<string, unknown>; // 固定不变的参数
}

interface WorkflowTemplate {
  skeleton: TemplateStepSkeleton[];
  paramSchema: z.ZodObject<any>;     // 动态参数的 Zod schema，用于 withStructuredOutput
}

const WORKFLOW_TEMPLATES: Partial<Record<TaskIntent, WorkflowTemplate>> = {
  competitive_analysis: {
    skeleton: [
      {
        description: '对两个对象进行深度对比分析',
        skillName: 'competitive_analysis',
        dynamicParams: ['topic_a', 'topic_b', 'focus'],
        staticParams: {},
      },
      {
        description: '将对比结论整理成正式报告',
        skillName: 'report_packaging',
        dynamicParams: ['title'],
        staticParams: { task_id: '__TASK_ID__', source_material: STEP_RESULTS_PLACEHOLDER },
      },
    ],
    paramSchema: z.object({
      topic_a: z.string().describe('对比对象 A'),
      topic_b: z.string().describe('对比对象 B'),
      focus: z.string().describe('对比维度，如"性能、生态、学习曲线"'),
      title: z.string().describe('报告标题'),
    }),
  },
};

async function fillTemplateParams(
  template: WorkflowTemplate,
  state: AgentState,
  llm: ChatOpenAI,
  soMethod: string,
): Promise<PlanStepDef[]> {
  const chain = ChatPromptTemplate.fromMessages([
    ['system', '根据任务描述，提取模板所需的参数值。只返回 JSON。'],
    ['human', `任务：{revisionInput}\n任务 ID：{taskId}`],
  ]).pipe(llm.withStructuredOutput(template.paramSchema, { method: soMethod as any }));

  const params = await chain.invoke({ revisionInput: state.revisionInput, taskId: state.taskId });

  return template.skeleton.map((s, i) => ({
    stepIndex: i,
    description: s.description,
    skillName: s.skillName ?? null,
    toolHint: s.toolHint ?? null,
    skillInput: s.skillName ? {
      ...s.staticParams,
      ...Object.fromEntries(s.dynamicParams.map(k => [k, (params as any)[k]])),
      // 替换特殊占位符
      ...(s.staticParams.task_id === '__TASK_ID__' ? { task_id: state.taskId } : {}),
    } : null,
    toolInput: s.toolHint ? {
      ...s.staticParams,
      ...Object.fromEntries(s.dynamicParams.map(k => [k, (params as any)[k]])),
    } : null,
  }));
}
```

---

## 阶段三（P2）：SubAgent 模式与并行执行

### 3.1 web_research 子图化（Subgraph-as-Node）

**改动目标**
`web_research` Skill 目前在 executor 内部同步执行，5 次搜索 + 3 次抓取的中间事件全部涌入主图执行流。将其封装为独立子图（`addNode(name, compiledSubgraph)` 模式），主图只接收最终 `findings`，中间产物不污染主图 state，也不累积在 LLM 上下文中。

**关键 API（langgraph-fundamentals + langgraph-persistence）**
- `new StateGraph(subState).compile({ checkpointer: false })`：子图不需要 `interrupt`，用 `false` 关闭 checkpoint，避免开销和命名空间冲突
- `graph.addNode('research_agent', compiledSubgraph)`：子图作为节点，主图看不到子图内部 state
- 用 **wrapper async function** 做 state 映射，不依赖可能不兼容的内置 `input/output` 变换

> ⚠️ langgraph-fundamentals 警告：将子图直接传给 `addNode` 时，若子图 state schema 与父图不兼容，需要用 wrapper function 显式映射，不要依赖 `{ input, output }` 选项（TypeScript LangGraph.js 中未提供该选项）。

**影响模块**
- `src/agent/nodes/research-subgraph.ts`（新增）：独立子图定义
- `src/agent/agent.service.ts`：用 wrapper function 替换现有 executor 的 skill 内联路径（仅 web_research 步骤）

**不影响模块**
- `web-research.skill.ts`（保留，子图内部复用其逻辑）
- `executor.node.ts`（其他 Skill 路径不变）
- 所有 Tool、数据库 schema、EventPublisher

**关键链路影响**
当 Plan 步骤的 `skillName === 'web_research'` 时，executor 委托给子图执行；子图内部的 search/fetch/synthesize 节点有自己的 state，不写入主图 `stepResults`；只有 `findings` 和 `sources` 通过 wrapper 返回到主图。

**风险点**
- 子图编译需要在 `AgentService` 构建时完成，避免每次 Run 重复编译（性能）。
- 子图内的工具调用不经过 executor 的 `persistStepOutput`，`.steps/` 文件中不会有子图的中间数据。如果需要调试，需要在子图节点中单独实现持久化。
- `InMemoryStore`（当前使用）进程重启后丢失——这是已知限制，生产环境需替换为 `PostgresStore`。

**验证方式**
1. 新建 `research-subgraph.spec.ts`：mock search/fetch/synthesize 工具，验证子图独立执行并返回 `{ findings, sources }`
2. 功能验证：运行 research_report 任务，观察主图 state 的 `stepResults[0].toolOutput` 是综合结论而非原始搜索结果

```typescript
// src/agent/nodes/research-subgraph.ts — 新增

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { ToolRegistry } from '@/tool/tool.registry';
import { webResearchSynthesisPrompt } from '@/prompts';

const ResearchState = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, b) => b }),
  depth: Annotation<number>({ reducer: (_, b) => b, default: () => 3 }),
  urls: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  pageContents: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  findings: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  sources: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
});

export function buildResearchSubgraph(
  llm: ChatOpenAI,
  toolRegistry: ToolRegistry,
  signal: AbortSignal,
) {
  return new StateGraph(ResearchState)
    .addNode('search', async (state) => {
      const result = await toolRegistry.executeWithCache('web_search', {
        query: state.topic, max_results: state.depth,
      });
      const structured = result.structuredData as Array<{ url: string }> | undefined;
      const urls = structured
        ? structured.map(r => r.url).slice(0, state.depth)
        : Array.from(result.output.matchAll(/URL: (https?:\/\/\S+)/g), m => m[1]).slice(0, state.depth);
      return { urls };
    })
    .addNode('fetch', async (state) => {
      const contents: string[] = [];
      const srcs: string[] = [];
      for (const url of state.urls) {
        if (signal.aborted) break;
        const r = await toolRegistry.executeWithCache('fetch_url_as_markdown', { url });
        if (r.success) { contents.push(`--- ${url} ---\n${r.output}`); srcs.push(url); }
      }
      return { pageContents: contents, sources: srcs };
    })
    .addNode('synthesize', async (state) => {
      const contextText = state.pageContents.join('\n\n').slice(0, 8000);
      const chain = webResearchSynthesisPrompt.pipe(llm);
      const resp = await chain.invoke({ topic: state.topic, contextText }, { signal });
      const findings = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
      return { findings };
    })
    .addEdge(START, 'search')
    .addEdge('search', 'fetch')
    .addEdge('fetch', 'synthesize')
    .addEdge('synthesize', END)
    // checkpointer: false — 子图不需要 interrupt，关闭避免 checkpoint 开销
    .compile({ checkpointer: false });
}

// agent.service.ts — 用 wrapper function 将子图作为节点（显式 state 映射）

const compiledResearchSubgraph = buildResearchSubgraph(llm, toolRegistry, signal);

// 在 executor 节点内部，当 skillName === 'web_research' 时委托给子图：
// （或在 graph 中作为独立节点）
async function runResearchAgent(state: AgentState): Promise<Partial<AgentState>> {
  const result = await compiledResearchSubgraph.invoke({
    topic: state.revisionInput,
    depth: 3,
  });
  return {
    lastStepOutput: result.findings,
    // sources 通过 .steps/ 持久化，不写入主图 state
  };
}
```

---

### 3.2 Evaluator 降级策略

**改动目标**
当前 `retry → replan → fail` 三级缺少"降级使用替代工具"的选项。工具不可用（Docker 未启动、Playwright 未安装）时应降级，而非直接 replan 整个计划。

**影响模块**
- `src/agent/nodes/evaluator.node.ts`：`runPreChecks` 新增降级分支
- `src/agent/agent.state.ts`：可在 `EvaluationResult.metadata` 中携带 `fallbackTool`（已有 `metadata` 字段）

**不影响模块**
- `executor.node.ts`（executor 读取 `evaluation.metadata.fallbackTool` 做降级，只需一处 if 判断）
- 所有 Tool、数据库 schema

**关键链路影响**
`evaluator → executor`（retry 分支）：executor 在重试时检查 `evaluation.metadata.fallbackTool`，用替代工具替换当前步骤的 `toolHint`，而非重发相同请求。

**风险点**
- 降级工具的输出格式可能与原工具不同，Tool Calling LLM 需要能适应（通常可以）。
- `extractToolName` 函数需要从错误信息中可靠解析工具名，建议在 Tool 错误格式中标准化。

**验证方式**
1. 单测：`evaluator.node.spec.ts` 中，输入包含 `resource_unavailable` 的 `lastStepOutput`，验证返回 `{ decision: 'retry', metadata: { fallbackTool: '...' } }`
2. `pnpm test` 通过

```typescript
// evaluator.node.ts — runPreChecks 新增降级逻辑

const TOOL_FALLBACKS: Record<string, string> = {
  sandbox_run_node: 'think',              // Docker 不可用 → 跳过执行验证
  sandbox_run_python: 'think',
  browser_open: 'fetch_url_as_markdown',  // Playwright 不可用 → 静态抓取
};

// 在 runPreChecks 函数中，code_execution_failed 判断之前插入：
if (lower.includes('resource_unavailable') || lower.includes('docker') || lower.includes('playwright')) {
  // 从错误信息中提取工具名（格式：error (tool_execution_failed): resource_unavailable: sandbox_run_node）
  const toolMatch = trimmed.match(/resource_unavailable[:\s]+(\w+)/i);
  const failedTool = toolMatch?.[1] ?? '';
  const fallback = TOOL_FALLBACKS[failedTool];
  if (fallback && retryCount < maxRetries) {
    return {
      decision: 'retry',
      reason: `工具 ${failedTool} 不可用，降级使用 ${fallback}`,
      metadata: { fallbackTool: fallback },
    };
  }
}
```

---

### 3.3 Finalizer 反思写入 Store

**改动目标**
`finalizer` 写入 Store 的内容目前只有 `summary`/`completedAt`/`stepCount`，缺少"这次执行出了什么问题"和"用了哪些工具"。丰富反思字段后，Planner 在后续相似任务中能看到更有价值的历史信息，避免重复犯错。

**关键 API（langgraph-persistence）**
- `store.put(['task_memory', taskId], runId, reflection)`：`InMemoryStore` 进程重启后丢失；生产环境需替换为 `PostgresStore`（`@langchain/langgraph-checkpoint-postgres`）。

**影响模块**
- `src/agent/nodes/finalizer.node.ts`：`store.put` 写入的 value 对象扩充字段

**不影响模块**
- `planner.node.ts`（读取 Store 的 `memories[].value.summary` 已兼容，新字段只是增量）
- 所有 Tool、Skill、数据库 schema

**关键链路影响**
`finalizer → Store`：写入更丰富的反思数据；下次同一 taskId 的 Run 运行时，Planner 读取并展示给 LLM，辅助决策。

**风险点**
- `InMemoryStore` 在生产环境不可用：进程重启后所有记忆丢失，这是已知限制，需在部署文档中说明，并提供 `PostgresStore` 迁移路径。
- `failedSteps` 逻辑（过滤倒数第二步之前的失败步骤）需测试边界：只有 1 步时不出错。

**验证方式**
1. 单测：`finalizer.node.spec.ts` mock Store，验证 `store.put` 被调用时包含 `retryCount`/`replanCount`/`usedExecutors`
2. 运行有 retry 的任务，观察下次同 taskId 任务的 Planner 日志中 memoryContext 包含 `retryCount` 信息

```typescript
// finalizer.node.ts — 增强 Store 写入

if (store) {
  try {
    const usedExecutors = [...new Set(
      state.currentPlan?.steps.map(s => s.skillName ?? s.toolHint ?? 'think') ?? [],
    )];
    await store.put(
      ['task_memory', state.taskId],
      state.runId,
      {
        summary: `${state.revisionInput.slice(0, 100)} → ${state.stepResults.length} 步完成`,
        completedAt: new Date().toISOString(),
        stepCount: state.stepResults.length,
        // ── 新增反思字段 ──
        retryCount: state.retryCount,
        replanCount: state.replanCount,
        tokenUsed: state.usedTokens,
        usedExecutors,
        // 出现过问题的步骤描述（最多 3 个），供 Planner 参考
        problematicSteps: state.retryCount > 0 || state.replanCount > 0
          ? state.stepResults.slice(0, -1).map(s => s.description).slice(0, 3)
          : [],
      },
    );
  } catch {
    // Store 写入失败不阻断 finalizer
  }
}

// ⚠️ 注意：InMemoryStore 进程重启后数据丢失。
// 生产环境替换方式：
// import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
// private readonly store = PostgresSaver.fromConnString(process.env.DATABASE_URL);
```

---

### 3.4 并行 Fan-Out（Send API）

**改动目标**
`competitive_analysis` 需要搜索两个对象，目前是串行：先搜 A，再搜 B。用 LangGraph `Send` API 实现 fan-out，两个搜索并行，总耗时减少约 40-50%。

**关键 API（langgraph-fundamentals）**
- `Send`：`new Send('worker', { ...state, topic: '对象A' })`
- **必须**：`stepResults` 已有 `reducer: (a, b) => [...a, ...b]`，可安全合并并行结果 ✅
- **注意**：`currentStepIndex` 是单值字段（无 reducer），并行分支不能各自递增，需要用专门的 fan-in 节点处理

> ⚠️ `Send` 复杂度最高，建议在 3.1 子图模式稳定后再实现。

**影响模块**
- `src/agent/agent.service.ts`：planner → executor 的条件边改为支持 Send
- `src/agent/agent.state.ts`：新增 `parallelResults` reducer 字段用于 fan-in

**不影响模块**
- 串行执行路径（不满足并行条件时走原有路径）
- 所有 Tool、Skill、数据库

**关键链路影响**
`planner → executor`（仅 competitive_analysis skill 步骤）：从顺序单线程变为并行多分支，需要专门的 fan-in 节点合并结果。

**风险点**
- `currentStepIndex` 冲突：两个并行 executor 都会尝试设置 `currentStepIndex`，需要在 fan-in 节点统一处理，不在各分支中修改。
- 并行分支的错误处理比串行复杂，一个分支失败时需要中止其他分支。
- 该改动涉及主图拓扑结构变化，回归测试范围最广。

**验证方式**
1. 单测：mock `Send` 返回，验证 fan-out 产生两个并行调用
2. 功能验证：运行 competitive_analysis 任务，观察两个 `web_search` 调用的时间戳几乎相同
3. 完整 `pnpm test` 通过

```typescript
// 简化示意（实际实现需专门设计 fan-in 节点）
import { Send } from '@langchain/langgraph';

// agent.state.ts — 新增并行结果收集字段
parallelStepOutputs: Annotation<Array<{ stepIndex: number; output: string }>>({
  reducer: (a, b) => [...a, ...b],
  default: () => [],
}),

// agent.service.ts — planner 后的条件边
.addConditionalEdges('planner', (state: AgentState) => {
  const plan = state.currentPlan;
  if (!plan) return 'executor';

  // 目前只对 competitive_analysis 的 web_research 步骤做并行
  const currentStep = plan.steps[state.currentStepIndex];
  const nextStep = plan.steps[state.currentStepIndex + 1];
  if (
    currentStep?.skillName === 'competitive_analysis' &&
    state.currentStepIndex === 0
  ) {
    // fan-out：把 topic_a / topic_b 分别送到两个 research_agent 节点
    const input = currentStep.skillInput as { topic_a: string; topic_b: string };
    return [
      new Send('research_agent', { ...state, _parallelTopic: input.topic_a, _parallelIdx: 0 }),
      new Send('research_agent', { ...state, _parallelTopic: input.topic_b, _parallelIdx: 1 }),
    ];
  }

  return 'executor';
})
```

---

## 实施顺序

```
阶段一（P0）— 当前开始
  1.1  evaluator 动态上下文窗口 + 智能截断
  1.2  Skill 输出写 .steps/
  1.3  补齐 fetch_url_as_markdown / github_search 的 structuredData
  1.4  competitive-analysis.skill.ts 统一使用 structuredData

阶段二（P1）— P0 完成后
  2.1  SkillContext 增强（taskId / priorStepSummaries / remainingBudgetHint）
  2.2  web_research 质量门控
  2.3  增强 Tool Calling 系统提示
  2.4  code_fix Skill + INTENT_GUIDANCE 修复指引
  2.5  Router subType 二级字段
  2.6  WorkflowTemplate 参数化中间层（最后，依赖 2.5）

阶段三（P2）— P1 稳定后
  3.1  web_research 子图化（需要 buildResearchSubgraph）
  3.2  evaluator 降级策略（独立，可提前）
  3.3  finalizer 反思写入 Store（独立，可提前）
  3.4  并行 Send API（最后，最复杂）
```

---

## LangGraph.js API 使用状态

| API | 来自 skill | 当前状态 | 本方案新增 |
|-----|-----------|----------|------------|
| `Annotation.Root` + reducers | langgraph-fundamentals | ✅ 主图 state | 3.1 子图 state |
| `addConditionalEdges` | langgraph-fundamentals | ✅ evaluator → | 3.4 planner → Send |
| `Command({ resume })` | langgraph-fundamentals | ✅ HITL approval | — |
| `interrupt()` | langgraph-fundamentals | ✅ plan_first HITL | — |
| `Send` | langgraph-fundamentals | ❌ 未使用 | 3.4 并行 fan-out |
| `addNode(name, compiledSubgraph)` | langgraph-fundamentals | ❌ 未使用 | 3.1 子图节点 |
| `compile({ checkpointer: false })` | langgraph-persistence | ❌ 未使用 | 3.1 子图（无 interrupt 时关闭） |
| `MemorySaver` | langgraph-persistence | ✅ 主图 HITL | — |
| `InMemoryStore` | langgraph-persistence | ✅ 跨 Run 记忆 | 3.3 反思增强 |
| `getStore(config)` | langgraph-persistence | ✅ finalizer/planner | — |
| `store.put / search` | langgraph-persistence | ✅ 已实现 | 3.3 反思字段扩充 |
| `ChatPromptTemplate` | langgraph-fundamentals | ✅ 所有 prompt | 2.3 enhanced toolCalling, 2.6 template params |
| `withStructuredOutput` | langgraph-fundamentals | ✅ planner/evaluator/router | 2.6 参数 schema |

> ⚠️ **InMemoryStore 生产限制**（来自 langgraph-persistence skill）：`InMemoryStore` 进程重启后数据丢失，不适合生产环境。生产替换方案：`PostgresSaver.fromConnString(DATABASE_URL)`。当前阶段保留 InMemoryStore，需在部署文档中标注。

---

## NestJS 架构约束（来自 nestjs-best-practices skill）

| 规则 | 当前状态 | 本方案遵守方式 |
|------|----------|---------------|
| `arch-single-responsibility` | ✅ 各 Skill 独立 class | `code_fix` Skill 独立文件 `code-fix.skill.ts` |
| `arch-use-events` | ✅ EventPublisher 解耦 | 新增事件按已有模式（`task.events.ts`）扩展 |
| `di-prefer-constructor-injection` | ✅ AgentService 构造注入 | ResearchSubgraph 作为函数参数注入依赖 |
| `arch-use-repository-pattern` | ✅ callbacks 抽象 DB | 新 Skill 不直接访问 DB，只通过 tool 写文件 |

---

## 不做的事项

| 问题 | 原因 |
|------|------|
| Prompt injection 主动防御 | 安全专项 |
| 输出 XSS 净化 | 前端渲染层处理 |
| trace ID 串联 | 可观测性专项 |
| Agent 行为评测框架 | 工程质量专项 |
| 多轮澄清对话 | 需改前端 scope 过大 |
| 会话式沙箱（保持容器状态） | 容器编排变更 scope 过大 |
| 语义向量检索记忆 | 需引入向量数据库 ROI 不够 |
| `InMemoryStore` → `PostgresStore` | 数据库迁移专项，当前 InMemoryStore 功能够用 |
