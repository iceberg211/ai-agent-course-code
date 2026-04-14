# Mini-Manus 改进路线图

> 基于 `docs/问题.md` 13 个维度，映射到 LangGraph.js / LangChain.js 具体 API，按功能架构优先原则分阶段推进。
> 安全、边界条件、可观测性留后续专项。

---

## 0. 现状与已完成项

上一轮迭代（2026-04-14）已完成 6 项基础改进：

| 编号 | 改进 | 涉及文件 | 状态 |
|------|------|----------|------|
| P0-1 | Tool `structuredData` + `requires` 依赖声明 | tool.interface.ts, web-search.tool.ts, sandbox-*.tool.ts | **已完成** |
| P0-2 | Executor `.steps/` 宽带数据持久化 | executor.node.ts | **已完成** |
| P0-3 | Finalizer 写入 LangGraph Store（跨 Run 记忆） | finalizer.node.ts, planner.node.ts | **已完成** |
| P1-4 | Planner 工具可用性过滤（`getAvailableForPlanner`） | tool.registry.ts, agent.service.ts | **已完成** |
| P2-1 | Evaluator 决策追踪事件（`EVALUATOR_DECIDED`） | evaluator.node.ts, task.events.ts | **已完成** |
| P2-3 | Token 预算感知规划（`usedTokens` / `tokenBudget`） | agent.state.ts, planner.node.ts, agent.service.ts | **已完成** |

本文档聚焦 **尚未解决的功能架构问题**。

---

## 1. 问题核实：哪些问题映射到哪些 LangGraph 能力

下表对照 `问题.md` 13 个维度，标注问题现状和对应的 LangGraph.js / LangChain.js 解决方案：

| 维度 | 核心问题 | 框架解法 | 优先级 |
|------|----------|----------|--------|
| **一、上下文管理** | stepResults 全塞 state，无分层；evaluator 硬编码 `.slice(-3)` | Store 分层存储 + 动态上下文窗口 + 摘要压缩链 | **P0** |
| **二、规划** | 计划静态不可调；确定性/LLM 二元对立 | `Command({ goto, update })` 动态路由 + 模板参数化中间层 | **P1** |
| **三、SubAgent** | 单图无委托；Skill 内联污染上下文；无并行 | 子图即节点（`addNode(name, compiledSubgraph)`）+ `Send` 并行 | **P2** |
| **四、意图识别** | 5 类太粗；无澄清；缺"任务理解"环节 | Router 增加子类型 + Planner 前置任务分析步骤 | **P1** |
| **五、提示词** | 缺行为规范；Tool Calling prompt 太简单 | 统一 System Prompt 骨架 + 增强 Tool Calling 上下文 | **P1** |
| **六、其他** | 无降级策略；无反思 | evaluator 降级分支 + finalizer 后置反思写 Store | **P2** |
| **七、沙箱** | 一次性执行；无依赖安装；无代码修复闭环 | code_fix Skill + evaluator `replan` 携带错误上下文 | **P1** |
| **八、工具层** | 无依赖声明（browser_extract→browser_open）；输出格式不统一 | Tool `requires` 已做 + `structuredData` 补全 + 错误码扩展 | **P0** |
| **九、Skill** | 无自主决策；无 Skill 间调用；SkillContext 太薄 | 丰富 SkillContext + Skill 内质量门控 + Skill 组合模式 | **P1** |
| **十、安全** | Guardrail 只覆盖 Planner；无输出净化 | *后续专项* | defer |
| **十一、可观测性** | 无 trace 串联；无完整 prompt 记录 | *后续专项*（EVALUATOR_DECIDED 已做第一步） | defer |
| **十二、工程质量** | 无 Agent 行为测试；Skill 无测试 | *后续专项* | defer |
| **十三、数据流** | 宽带/窄带未分离（`.steps/` 已做第一步） | 补齐 Skill 输出持久化 + evaluator 智能上下文选取 | **P0** |

---

## 2. 分阶段改进方案

### 阶段一（P0）：上下文管理与数据流 — 打通信息通道

**目标**：解决"LLM 看到的信息不够 or 太多"的根本问题。

#### 1.1 Evaluator 动态上下文窗口

**问题**：`evaluator.node.ts:197` 硬编码 `lastStepOutput.slice(0, 1000)` 写入 stepResults，evaluator prompt 的 `recentSummaries` 固定取最近 3 步 `.slice(-3)`。

**方案**：根据输出长度动态决定截断策略，evaluator 按相关性选取上下文而非固定窗口。

```typescript
// evaluator.node.ts — 改进 recentSummaries 构建逻辑

// 之前：固定取最近 3 步
const recent = state.stepResults.slice(-3);

// 之后：按 token 预算动态选取，优先保留当前步骤和失败步骤
function buildRecentSummaries(
  stepResults: StepResult[],
  maxChars = 3000,
): string {
  if (stepResults.length === 0) return '暂无';
  
  // 当前步骤始终包含（最重要的上下文）
  const current = stepResults[stepResults.length - 1];
  let result = `[当前] ${current.description}: ${current.toolOutput ?? current.resultSummary}`;
  let remaining = maxChars - result.length;
  
  // 倒序遍历历史步骤，优先保留有错误信息的
  for (let i = stepResults.length - 2; i >= 0 && remaining > 200; i--) {
    const s = stepResults[i];
    const line = `[步骤${s.executionOrder + 1}] ${s.description}: ${(s.toolOutput ?? s.resultSummary).slice(0, 300)}`;
    if (line.length > remaining) break;
    result = line + '\n' + result;
    remaining -= line.length;
  }
  return result;
}
```

**LangChain 映射**：纯逻辑优化，不需要新 API。关键是改变"固定窗口"思维，按信息价值动态选取。

#### 1.2 StepResult 智能截断（摘要优先于硬切）

**问题**：`toolOutput: lastStepOutput.slice(0, 1000)` 硬切可能丢失关键 URL 和结论。

**方案**：短输出直接保留；长输出先尝试提取结构化摘要，提取失败再硬切。

```typescript
// evaluator.node.ts — applyDecision 中构建 newStepResult 时

function smartTruncate(output: string, limit = 1500): string {
  if (output.length <= limit) return output;
  
  // 如果输出包含 structuredData（.steps/ 文件有完整数据），
  // state 里只保留"指针 + 关键摘要"
  // 优先保留：URL、数字结论、错误信息
  const lines = output.split('\n');
  const important = lines.filter(line => 
    /https?:\/\//.test(line) ||       // URL
    /error|fail|成功|完成/.test(line) || // 状态
    /^\d+\./.test(line.trim())         // 编号列表
  );
  
  if (important.length > 0) {
    const summary = important.join('\n').slice(0, limit - 100);
    return summary + `\n[完整输出已写入 .steps/ 目录，共 ${output.length} 字符]`;
  }
  
  // fallback: 头尾保留
  const head = output.slice(0, limit * 0.7);
  const tail = output.slice(-limit * 0.2);
  return head + `\n...[省略 ${output.length - limit} 字符]...\n` + tail;
}
```

#### 1.3 Skill 输出也写 .steps/

**问题**：executor 中 skill 路径没有把 `structuredData` 传给 `persistStepOutput()`。

**方案**：在 executor.node.ts 的 skill 成功路径中，传入 skill 的结构化 output。

```typescript
// executor.node.ts — skill 成功路径
// 当前代码（约 line 440）只传了 output 字符串：
await persistStepOutput(workspace, state.taskId, state.executionOrder, skillName, stepDef.description, outputStr);

// 改为同时传入 structuredData：
await persistStepOutput(workspace, state.taskId, state.executionOrder, skillName, stepDef.description, outputStr, skillOutput);
```

#### 1.4 补齐 structuredData 到更多工具

**问题**：目前只有 `web_search` 返回了 `structuredData`，其他工具（`fetch_url_as_markdown`, `github_search`, `read_file`）没有。

**方案**：为高频工具补齐 structuredData，让 Skill 和 Tool Calling 有结构化数据可用。

```typescript
// fetch-url-as-markdown.tool.ts — 补齐
return {
  success: true,
  output: truncateOutput(markdown),
  structuredData: {
    url: input.url,
    title: extractTitle(markdown),     // 从 markdown 第一行 # 提取
    contentLength: markdown.length,
  },
};

// github-search.tool.ts — 补齐  
return {
  success: true,
  output: truncateOutput(formatted),
  structuredData: items.map(item => ({
    name: item.full_name,
    url: item.html_url,
    description: item.description,
    stars: item.stargazers_count,
  })),
};
```

#### 1.5 competitive-analysis.skill.ts 使用 structuredData

**问题**：`competitive-analysis.skill.ts:56-59` 还在用正则 `URL: (https?:\/\/\S+)` 提取 URL，和 web-research.skill.ts 改进前一样的问题。

**方案**：统一改用 `structuredData` 优先，和 web-research.skill.ts 一致。

---

### 阶段二（P1）：规划灵活性与 Skill 能力增强

**目标**：让计划不再是"一锤定音"，Skill 有最低质量保证。

#### 2.1 模板 + 参数化规划中间层

**问题**：只有"完全硬编码"（DETERMINISTIC_WORKFLOWS）和"完全 LLM"两种选择。

**方案**：引入 `WorkflowTemplate`，模板定义步骤骨架，LLM 填参数。

```typescript
// planner.node.ts — 新增 WorkflowTemplate 概念

interface WorkflowTemplate {
  /** 步骤骨架（固定的 skill/tool 选择） */
  skeleton: Array<{
    description: string;
    skillName?: string;
    toolHint?: string;
    /** 哪些参数由 LLM 根据用户任务动态填充 */
    dynamicParams: string[];
    /** 固定参数 */
    staticParams: Record<string, unknown>;
  }>;
}

// 示例：research_report 模板化
const RESEARCH_TEMPLATE: WorkflowTemplate = {
  skeleton: [
    {
      description: '围绕主题进行深度网络调研',
      skillName: 'web_research',
      dynamicParams: ['topic', 'depth'],  // LLM 根据任务决定搜什么、搜多深
      staticParams: {},
    },
    {
      description: '基于调研结果生成完整报告',
      skillName: 'report_packaging',
      dynamicParams: ['title'],            // LLM 决定报告标题
      staticParams: { source_material: STEP_RESULTS_PLACEHOLDER },
    },
  ],
};

// 用一次轻量 LLM 调用填充动态参数（比完整规划便宜很多）
async function fillTemplateParams(
  template: WorkflowTemplate,
  state: AgentState,
  llm: ChatOpenAI,
): Promise<PlanStepDef[]> {
  // ... 轻量 structured output 调用，只输出参数值
}
```

**LangChain 映射**：`ChatPromptTemplate` + `withStructuredOutput`，一个小 schema 只包含动态参数字段。

**扩展性**：新增意图只需写模板 skeleton，不用写完整的 DETERMINISTIC_WORKFLOWS builder。

#### 2.2 SkillContext 增强

**问题**（问题九.6）：SkillContext 只注入了 tools/llm/workspace/signal/soMethod，缺少步骤上下文、预算信息、记忆。

**方案**：扩展 SkillContext 接口，executor 传入更多运行时信息。

```typescript
// skill.interface.ts — 扩展 SkillContext
export interface SkillContext {
  tools: ToolRegistry;
  llm: ChatOpenAI;
  workspace: WorkspaceService;
  signal: AbortSignal;
  soMethod: 'functionCalling' | 'json_schema' | 'jsonMode';
  
  // ── 新增字段 ──
  /** 当前任务 ID */
  taskId: string;
  /** 前序步骤的执行摘要（Skill 可据此调整行为） */
  priorStepSummaries: string[];
  /** 剩余 token 预算（粗估），Skill 可据此控制调用深度 */
  remainingBudgetHint: number;
}
```

**executor.node.ts 对应修改**：构建 SkillContext 时注入新字段。

#### 2.3 Skill 质量门控

**问题**（问题九.2/4）：web_research 搜索结果为空时直接用空内容综合；无最低质量门槛。

**方案**：在 Skill 内部加质量检查，不达标时换策略或提前退出。

```typescript
// web-research.skill.ts — Step 1 后增加质量检查

// ... 搜索完成后 ...

// 质量门控：搜索结果不足时换关键词重试一次
if (urls.length < 2 && !ctx.signal.aborted) {
  yield { type: 'progress', message: `搜索结果不足（${urls.length} 条），尝试扩展关键词…` };
  
  const fallbackResult = await ctx.tools.executeWithCache('web_search', {
    query: `${topic} 最新进展 综述`,  // 扩展关键词
    max_results: maxPages,
  });
  yield { type: 'tool_result', tool: 'web_search', output: fallbackResult.output, /* ... */ };
  
  const fallbackStructured = fallbackResult.structuredData as Array<{ url: string }> | undefined;
  const fallbackUrls = fallbackStructured
    ? fallbackStructured.map(r => r.url)
    : Array.from(fallbackResult.output.matchAll(/URL: (https?:\/\/\S+)/g), m => m[1]);
  urls.push(...fallbackUrls.filter(u => !urls.includes(u)).slice(0, maxPages - urls.length));
}

// 最终仍无结果时，yield 一个有意义的错误而非空综合
if (urls.length === 0) {
  yield { type: 'result', output: { findings: `未找到关于"${topic}"的有效搜索结果，建议换一个更具体的关键词重试。`, sources: [] } };
  return;
}
```

#### 2.4 代码修复闭环（code_fix Skill）

**问题**（问题七.5）：沙箱执行失败后 evaluator 的 replan 是重新规划整个任务，太粗暴。应该只修复代码。

**方案**：新建 `code_fix` Skill，replan 时 Planner 可以选择用它替代重新生成。

```typescript
// skill/skills/code-fix.skill.ts — 新增

const inputSchema = z.object({
  task_id: z.string().uuid(),
  error_output: z.string().describe('沙箱运行的错误输出（stderr + exitCode）'),
  project_dir: z.string().default('project'),
});

// Skill 逻辑：
// 1. 读取项目文件列表（list_directory）
// 2. 读取主入口文件和 package.json
// 3. 结合 error_output，让 LLM 定位问题并生成修复 patch
// 4. 写入修复后的文件
// 5. 返回修复的文件列表
```

**Planner 配合**：replan 时如果前次 stepResults 包含 `code_execution_failed`，INTENT_GUIDANCE 提示 Planner 用 code_fix 而非重新生成。

```typescript
// prompts/index.ts — INTENT_GUIDANCE.code_generation 追加

`如果前次执行出现代码错误（code_execution_failed），请优先使用 code_fix skill 修复，
不要重新生成整个项目。code_fix 输入需要包含错误信息。`
```

#### 2.5 增强 Tool Calling Prompt

**问题**（问题五.4）：toolCallingPrompt 只有两行指导，LLM 不知道如何选择参数、处理冲突。

**方案**：

```typescript
// prompts/index.ts — 增强 toolCallingPrompt

export const toolCallingPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个工具调用助手。根据步骤目标和前序步骤的执行结果，调用指定工具并填入正确参数。

核心规则：
1. 必须调用工具，不要只回复文字
2. 参数来源优先级：前序步骤的真实输出 > 步骤描述中的线索 > 合理推断
3. URL 参数：只使用前序步骤中明确出现的 URL，不要编造
4. task_id 参数：始终使用当前任务的 task_id，不要修改
5. 文件路径：参考前序步骤输出中的文件列表，不要猜测

上下文获取：前序步骤的完整输出保存在 .steps/ 目录（文件名格式：.steps/step_{序号}_{工具名}.json），
可通过 read_file 按需读取。下方摘要已包含关键信息，通常无需额外读取。

错误处理：如果前次执行失败（下方有 retryHint），请分析失败原因并选择不同的参数。
常见修复：换一个 URL、调整查询词、减小数据量。`,
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

#### 2.6 意图识别增强

**问题**（问题四.1）：5 个意图类别太粗，`code_generation` 涵盖了差异巨大的子类型。

**方案**：Router 增加二级子类型字段，不改变主流程，给 Planner 更多决策信息。

```typescript
// router.node.ts — 增加 subType

const IntentSchema = z.object({
  intent: z.enum(VALID_INTENTS as [TaskIntent, ...TaskIntent[]]),
  subType: z.string().describe('更细化的任务子类型，如 web_app / cli_tool / data_script / api_server'),
  reason: z.string(),
});

// agent.state.ts — 新增字段
taskIntentSubType: Annotation<string>({
  reducer: (_, b) => b,
  default: () => '',
}),
```

Planner 的 INTENT_GUIDANCE 可以读取 `subType` 做更精确的策略选择。

---

### 阶段三（P2）：SubAgent 模式与并行执行

**目标**：引入 LangGraph 高级编排能力，为多 Agent 打基础。

#### 3.1 Skill 作为子图（Subgraph-as-Node）

**问题**（问题三）：Skill 在 executor 内部执行，中间产物（5 次搜索 + 3 次抓取）全部进入主图上下文。

**方案**：将 web_research 封装为独立子图，主图只接收最终结果。

```typescript
// 子图定义
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';

const ResearchStateAnnotation = Annotation.Root({
  topic: Annotation<string>({ reducer: (_, b) => b }),
  depth: Annotation<number>({ reducer: (_, b) => b, default: () => 3 }),
  findings: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  sources: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
});

const researchSubgraph = new StateGraph(ResearchStateAnnotation)
  .addNode('search', async (state) => { /* web_search */ })
  .addNode('fetch', async (state) => { /* fetch pages */ })
  .addNode('synthesize', async (state) => { /* LLM synthesize */ })
  .addEdge(START, 'search')
  .addEdge('search', 'fetch')
  .addEdge('fetch', 'synthesize')
  .addEdge('synthesize', END)
  .compile();

// 主图中作为节点使用
// 主图 state 通过 stateMapping 映射到子图 state
graph.addNode('research_agent', researchSubgraph, {
  // 输入映射：主图 → 子图
  input: (mainState) => ({
    topic: mainState.revisionInput,
    depth: 3,
  }),
  // 输出映射：子图 → 主图
  output: (subState) => ({
    lastStepOutput: subState.findings,
    // 子图的中间搜索/抓取步骤不进入主图 state
  }),
});
```

**LangGraph 映射**：`graph.addNode(name, compiledSubgraph)` — 这是 LangGraph.js 原生支持的子图即节点模式。

**关键收益**：
- 子图有自己的 state，中间产物不污染主图
- 子图内部可以有自己的循环（搜索质量不够 → 换关键词重搜）
- 未来可以给子图单独配 LLM（用便宜模型做搜索决策）

#### 3.2 并行 Fan-Out（Send API）

**问题**（问题三.5）：步骤只能串行（`currentStepIndex + 1`）。competitive_analysis 搜两个竞品应该并行。

**方案**：使用 LangGraph 的 `Send` API 实现 fan-out → fan-in。

```typescript
import { Send } from '@langchain/langgraph';

// 条件边中使用 Send 做并行 fan-out
.addConditionalEdges('planner', (state: AgentState) => {
  const plan = state.currentPlan;
  if (!plan) return 'executor';
  
  // 检测可并行的步骤组（同一 skill、无依赖关系）
  const parallelGroup = detectParallelSteps(plan.steps, state.currentStepIndex);
  
  if (parallelGroup.length > 1) {
    // fan-out：每个并行步骤发送到独立的 executor 实例
    return parallelGroup.map(step => 
      new Send('executor', { 
        ...state, 
        currentStepIndex: step.stepIndex,
        // 每个并行分支只看自己的步骤
      })
    );
  }
  
  return 'executor';
})
```

**注意**：Send 要求目标节点能处理 fan-in。需要在 AgentState 中用 reducer 合并并行结果。这是高级特性，建议在子图模式稳定后再引入。

#### 3.3 Evaluator 降级策略

**问题**（问题六.1）：当前只有 retry → replan → fail 三级，缺少"降级"选项。

**方案**：在 evaluator 的 preCheck 中增加降级分支。

```typescript
// evaluator.node.ts — runPreChecks 新增降级逻辑

// 工具不可用时的降级映射
const TOOL_FALLBACKS: Record<string, string> = {
  'web_search': 'fetch_url_as_markdown',    // 搜索不可用 → 直接抓已知 URL
  'browser_open': 'fetch_url_as_markdown',  // 浏览器不可用 → 静态抓取
  'sandbox_run_node': 'think',              // 沙箱不可用 → 跳过执行验证
};

// 如果错误是"工具不可用"类型，evaluator 可以建议替代工具
// 通过在 EvaluationResult.metadata 中携带替代建议
if (lower.includes('resource_unavailable') || lower.includes('tool not found')) {
  const currentTool = extractToolName(lower);
  const fallback = TOOL_FALLBACKS[currentTool];
  if (fallback) {
    return {
      decision: 'retry',
      reason: `工具 ${currentTool} 不可用，降级使用 ${fallback}`,
      metadata: { fallbackTool: fallback },
    };
  }
}
```

#### 3.4 Finalizer 反思写入 Store

**问题**（问题六.4）：finalizer 只总结产出，不反思过程。

**方案**：在 finalizer 的 Store 写入中增加反思维度。

```typescript
// finalizer.node.ts — 增强 Store 写入

if (store) {
  const reflection = {
    summary: `${state.revisionInput.slice(0, 100)} → ${state.stepResults.length} 步完成`,
    completedAt: new Date().toISOString(),
    stepCount: state.stepResults.length,
    // ── 新增反思字段 ──
    retryCount: state.retryCount,
    replanCount: state.replanCount,
    tokenUsed: state.usedTokens,
    // 记录哪些步骤出过错（供未来 Planner 参考）
    failedSteps: state.stepResults
      .filter((_, i) => i < state.stepResults.length - 1) // 最后一步成功不计
      .map(s => s.description)
      .slice(0, 3),
    // 成功使用的工具/技能组合（供未来相似任务复用）
    usedExecutors: [...new Set(
      state.currentPlan?.steps.map(s => s.skillName ?? s.toolHint ?? 'think') ?? []
    )],
  };
  
  await store.put(['task_memory', state.taskId], state.runId, reflection);
}
```

Planner 读取这些反思信息后，可以对相似任务做出更好的规划决策。

---

## 3. 实施顺序

```
阶段一（P0）— 打通信息通道
  ├─ 1.1 evaluator 动态上下文窗口
  ├─ 1.2 stepResult 智能截断
  ├─ 1.3 skill 输出写 .steps/
  ├─ 1.4 补齐工具 structuredData
  └─ 1.5 competitive-analysis 用 structuredData

阶段二（P1）— 规划灵活性 + Skill 增强
  ├─ 2.2 SkillContext 增强
  ├─ 2.3 Skill 质量门控（web_research）
  ├─ 2.5 增强 Tool Calling prompt
  ├─ 2.4 代码修复闭环（code_fix skill）
  ├─ 2.6 意图识别增强（subType）
  └─ 2.1 模板参数化（WorkflowTemplate）—— 最后做，依赖前面的成果

阶段三（P2）— SubAgent 模式（为多 Agent 打基础）
  ├─ 3.1 web_research 子图化
  ├─ 3.4 finalizer 反思写入
  ├─ 3.3 evaluator 降级策略
  └─ 3.2 并行 Send API —— 最后做，复杂度最高
```

每个改进独立可交付、可测试。后一阶段的改进不阻塞前一阶段。

---

## 4. 每项改进涉及的文件清单

| 改进 | 修改文件 | 新增文件 | 测试覆盖 |
|------|----------|----------|----------|
| 1.1 动态上下文 | evaluator.node.ts | — | evaluator.node.spec.ts |
| 1.2 智能截断 | evaluator.node.ts | — | evaluator.node.spec.ts |
| 1.3 skill 写 .steps/ | executor.node.ts | — | 现有测试 |
| 1.4 补齐 structuredData | fetch-url-as-markdown.tool.ts, github-search.tool.ts | — | 对应工具测试 |
| 1.5 competitive-analysis | competitive-analysis.skill.ts | — | — |
| 2.2 SkillContext | skill.interface.ts, executor.node.ts | — | — |
| 2.3 质量门控 | web-research.skill.ts | — | web-research.skill.spec.ts（新建） |
| 2.4 code_fix | planner.node.ts, prompts/index.ts | code-fix.skill.ts | code-fix.skill.spec.ts |
| 2.5 Tool Calling prompt | prompts/index.ts | — | — |
| 2.6 意图增强 | router.node.ts, agent.state.ts | — | router.node.spec.ts |
| 2.1 WorkflowTemplate | planner.node.ts | — | planner.node.spec.ts |
| 3.1 子图化 | agent.service.ts | research-subgraph.ts | research-subgraph.spec.ts |
| 3.2 并行 Send | agent.service.ts, agent.state.ts | — | — |
| 3.3 降级策略 | evaluator.node.ts | — | evaluator.node.spec.ts |
| 3.4 反思 Store | finalizer.node.ts | — | finalizer.node.spec.ts |

---

## 5. 与 LangGraph.js API 的完整映射

| LangGraph.js API | 已使用 | 本方案新增使用 |
|-----------------|--------|---------------|
| `StateGraph` + `Annotation.Root` | ✅ 主图 | 3.1 子图 |
| `InMemoryStore` + `getStore(config)` | ✅ finalizer/planner | 3.4 反思增强 |
| `MemorySaver` checkpointer | ✅ HITL | — |
| `Command({ resume })` | ✅ HITL approval | — |
| `interrupt()` | ✅ HITL plan_first | — |
| `addNode(name, compiledSubgraph)` | ❌ | 3.1 子图即节点 |
| `Send` | ❌ | 3.2 并行 fan-out |
| `ChatPromptTemplate` | ✅ 所有 prompt | 2.1 模板参数填充 |
| `withStructuredOutput` | ✅ planner/evaluator/router | 2.1 参数 schema |
| `tool()` from `@langchain/core/tools` | ✅ Tool Calling | — |

---

## 6. 不做的事项（明确排除）

以下问题在问题文档中提到，但本轮不做：

| 问题 | 原因 |
|------|------|
| Prompt injection 主动防御（问题十） | 安全专项，当前 passive 声明已够用 |
| 输出 XSS 净化（问题十） | 前端渲染层处理 |
| trace ID 串联（问题十一） | 可观测性专项 |
| LLM prompt 完整记录（问题十一） | 可观测性专项 |
| Agent 行为评测框架（问题十二） | 工程质量专项 |
| 多轮澄清对话（问题四.2） | 需改前端交互流程，scope 过大 |
| 会话式沙箱（问题七.1） | 需要容器编排变更，scope 过大 |
| 语义向量检索记忆（问题一.5） | 需引入向量数据库，ROI 不够 |
