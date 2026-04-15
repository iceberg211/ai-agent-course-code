# 数字人 Agent：记忆功能 + Agentic RAG 设计方案

> 项目：digital-human-agent  
> 日期：2026-04-15  
> 方案：双阶段独立架构（Phase 1 记忆 → Phase 2 Agentic RAG）

---

## 背景

当前 digital-human-agent 的 RAG 是固定流水线：查询 → pgvector 向量检索 → 可选 reranker → 注入 prompt → 生成。对话历史为固定 10 条滑动窗口，无跨会话记忆能力。

本方案分两个阶段升级：
- **Phase 1**：在不改变现有 Agent 结构的前提下，增加短期对话摘要和长期用户记忆
- **Phase 2**：引入 LangGraph StateGraph，将传统 RAG 升级为 Agentic RAG，记忆成为其中一个检索源

两个阶段独立可交付，Phase 1 的产出在 Phase 2 中完全复用。

---

## Phase 1：记忆功能

### 1.1 短期对话摘要

**问题**：固定取最近 10 条 completed messages，长对话中早期重要信息丢失。

**方案**：渐进式摘要（Progressive Summarization）。

**触发条件**：当 conversation 的 completed 消息数超过阈值时触发。阈值为可配置常量 `SUMMARY_THRESHOLD`，默认 16 条。

**流程**：
1. 取最早的 N 条消息（如前 10 条）
2. LLM 生成摘要，存入 `conversation` 表的 `summary` 字段
3. 记录 `summarized_up_to`（已摘要到第几条消息的 seq）
4. 后续 prompt 构建：`[系统提示] + [摘要] + [最近 6 条消息] + [用户输入]`

**渐进更新**：下次再超阈值时，取 `[旧摘要] + [新的早期消息]` → LLM 生成更新后的摘要。不重新全量总结，只增量合并。

**数据变更**：
```sql
ALTER TABLE conversation ADD COLUMN summary TEXT;
ALTER TABLE conversation ADD COLUMN summarized_up_to INT DEFAULT 0;
```

**触发时机**：在 `AgentService.run()` 加载历史时判断——总消息数超过阈值则先触发摘要再构建 prompt。

**摘要 Prompt**：
```
你是对话摘要助手。请将以下对话历史浓缩为简洁的摘要，保留：
- 用户提到的关键事实和偏好
- 对话的主要话题和结论
- 任何未解决的问题

已有摘要（如果有）：{existing_summary}
新增对话：{messages}

请输出更新后的完整摘要。
```

**代码位置**：新增 `conversation-summary.service.ts`，被 `AgentService` 调用。

### 1.2 长期记忆

**存取方式**：显式指令式。用户主动说"记住…"才存储，说"我之前说过什么"才召回，说"忘掉…"才删除。

**数据模型**：
```sql
CREATE TABLE user_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  UUID NOT NULL REFERENCES persona(id),
  user_id     VARCHAR(255) NOT NULL,
  content     TEXT NOT NULL,
  category    VARCHAR(50),  -- preference / fact / event
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_user_memory_lookup ON user_memory(persona_id, user_id);
```

> `user_id` 暂用 conversationId 标识用户，未来接入用户系统后替换为真实 user_id。

**意图识别方式**：ChatOpenAI 的 tool calling（`bindTools`），定义 3 个 tool schema：

| Tool | 触发场景 | 行为 |
|------|---------|------|
| `save_memory(content, category?)` | "记住：我对花粉过敏" | 存入 user_memory 表，回复确认 |
| `recall_memory(query)` | "我之前跟你说过什么？" | 按 persona_id + user_id 查询，注入 prompt |
| `delete_memory(query)` | "忘掉我说的过敏信息" | 模糊匹配删除，回复确认 |

**recall 匹配策略**：Phase 1 用 SQL `ILIKE` + 关键词匹配（记忆条数有限，足够用）。Phase 2 升级后可加 embedding 做向量召回。

**执行流程**：
```
用户输入 → AgentService.run()
  ├─ 1. 加载历史 + 摘要（Phase 1.1）
  ├─ 2. LLM tool calling 意图识别
  │     → 是否需要调用 save_memory / recall_memory / delete_memory
  ├─ 3a. 触发记忆工具 → MemoryService 执行操作
  │     → 如果是 recall，将记忆注入后续 prompt
  │     → 如果是 save/delete，执行后继续正常流程
  ├─ 3b. 未触发 → 正常 RAG 流程
  └─ 4. LLM 生成回答（streaming）
```

### 1.3 Phase 1 代码改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `conversation/conversation.entity.ts` | 修改 | 新增 `summary`、`summarizedUpTo` 字段 |
| `conversation/conversation-summary.service.ts` | 新增 | 渐进式摘要生成逻辑 |
| `memory/memory.entity.ts` | 新增 | TypeORM 实体 |
| `memory/memory.service.ts` | 新增 | 记忆 CRUD + 查询 |
| `memory/memory.module.ts` | 新增 | NestJS 模块 |
| `agent/agent.service.ts` | 修改 | 摘要加载 + tool calling 意图识别 + 记忆注入 |
| `agent/agent.module.ts` | 修改 | 导入 MemoryModule |
| `supabase/migrations/` | 新增 | user_memory 表 + conversation 表加字段 |

---

## Phase 2：Agentic RAG

### 2.1 设计目标

将固定 RAG 流水线升级为 Agent 自主决策的智能闭环：
1. 对复杂问题进行意图理解与拆解，生成子问题
2. 根据问题类型智能路由到不同检索源
3. 检索后进行信息融合、重排、去重
4. 反思评估信息是否充分
5. 不满足则重新构造查询、再次检索（最多 3 次迭代）
6. 确认充分后生成最终回答

### 2.2 LangGraph 状态定义

```typescript
// LangGraph Annotation 定义（注意 retrievedChunks 使用 reducer 合并并行结果）
const AgenticRAGState = Annotation.Root({
  // 输入
  userMessage: Annotation<string>,
  conversationId: Annotation<string>,
  personaId: Annotation<string>,
  userId: Annotation<string>,
  chatHistory: Annotation<BaseMessage[]>,
  persona: Annotation<PersonaConfig>,

  // Agent 工作状态
  subQuestions: Annotation<string[]>,
  routingPlan: Annotation<RoutingDecision[]>,
  retrievedChunks: Annotation<RetrievedChunk[]>({
    reducer: (a, b) => [...a, ...b],  // 并行 Send() 返回的结果自动合并
    default: () => [],
  }),
  mergedContext: Annotation<string>,

  // 反思循环
  reflectionResult: Annotation<ReflectionResult | null>,
  iterationCount: Annotation<number>({ default: () => 0 }),

  // 记忆操作（复用 Phase 1）
  memoryActions: Annotation<MemoryAction[]>({ default: () => [] }),

  // 输出
  finalAnswer: Annotation<string>,
  citations: Annotation<Citation[]>({ default: () => [] }),
});

interface RoutingDecision {
  question: string;
  sources: ('vector' | 'web' | 'memory' | 'tool')[];
  reason: string;
}

interface ReflectionResult {
  sufficient: boolean;
  missing: string[];
  conflicts: string[];
  revisedQueries: string[];
  nextSources: string[];
}

interface MemoryAction {
  type: 'save' | 'recall' | 'delete';
  content: string;
  category?: string;
}
```

### 2.3 图结构

```
                    ┌─────────────┐
         ──────────►│  analyzer   │ 意图分析
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   router    │ 智能路由（或直接跳 generator）
                    └──────┬──────┘
                           │ Send() 并行分发
              ┌────────────┼────────────┬────────────┐
              ▼            ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  vector  │ │   web    │ │  memory  │ │   tool   │
        └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
             └────────────┼────────────┼────────────┘
                    ┌─────▼──────┐
                    │   merge    │ 信息融合（去重 + 重排）
                    └──────┬─────┘
                    ┌──────▼──────┐
                    │  reflect    │ 反思评估
                    └──────┬──────┘
                           │
                     sufficient?
                    ┌──yes─┴──no──┐
                    ▼             ▼
              ┌──────────┐  回到 router
              │ generator │ （带修正查询，iteration < 3）
              └──────────┘
```

### 2.4 节点职责

#### analyzer（意图分析）

输入：userMessage + chatHistory + persona  
输出：subQuestions + routingPlan + memoryActions

LLM 判断：
- **简单寒暄**：不需要检索，condition edge 直接跳到 generator
- **知识类问题**：拆解为 1-3 个子问题，为每个子问题分配检索源
- **记忆操作**：识别"记住/忘掉/我之前说过"等意图，写入 memoryActions

#### router（智能路由）

根据 routingPlan 用 `Send()` API 并行分发到检索节点：

```typescript
function routeToSources(state: AgenticRAGState): Send[] {
  const sends: Send[] = [];
  for (const decision of state.routingPlan) {
    for (const source of decision.sources) {
      sends.push(new Send(source, {
        query: decision.question,
        ...relevantStateFields,
      }));
    }
  }
  if (state.memoryActions.length > 0) {
    sends.push(new Send('memory', state));
  }
  return sends;
}
```

快速路径：如果 analyzer 判定为简单寒暄（routingPlan 为空），condition edge 直接跳到 generator。

#### vector（向量检索）

直接调用现有 `KnowledgeService.retrieve(query, personaId, { rerank: true })`。无需改动。

#### web（网络搜索）

新增 `WebSearchService`，封装搜索 API。返回统一的 `RetrievedChunk` 格式：

```typescript
interface RetrievedChunk {
  content: string;
  source: string;       // 来源标识：'vector' | 'web' | 'memory' | 'tool:xxx'
  sourceUrl?: string;    // web 结果的原始 URL
  similarity?: number;   // vector 的相似度分数
  metadata?: Record<string, unknown>;
}
```

搜索 API 选型留为配置项（`WEB_SEARCH_PROVIDER`），默认支持 Tavily。

#### memory（记忆查询/操作）

复用 Phase 1 的 `MemoryService`，双重角色：
- **检索源**：根据子问题查询相关记忆，返回 `RetrievedChunk[]`
- **执行操作**：处理 analyzer 识别的 save/delete 指令

Phase 2 升级：给 user_memory 表加 `embedding VECTOR(1024)` 字段，recall 时用向量检索替代 SQL ILIKE。

#### tool（可扩展工具）

通用 Tool 执行器。通过接口注册，不实现具体 Tool：

```typescript
interface AgenticTool {
  name: string;
  description: string;
  schema: z.ZodSchema;
  execute(input: unknown): Promise<RetrievedChunk[]>;
}
```

任何 NestJS Service 实现此接口并通过 DI 注册即可被 router 分发调用。

#### merge（信息融合）

收集所有检索节点返回的 chunks：
1. 按 content 指纹去重（避免 vector 和 web 返回相同内容）
2. 调用 `RerankerService.rerank()` 对全量结果重排
3. 取 top-K（8 条）
4. 拼接为结构化上下文字符串，标注来源

#### reflect（反思）

LLM 评估 mergedContext 是否足以回答所有子问题：

```
你是信息完整性评估员。

用户原始问题：{userMessage}
子问题：{subQuestions}
已检索信息：{mergedContext}

请评估：
1. 信息是否充分回答了所有子问题？
2. 信息之间是否存在矛盾？
3. 是否有明显的信息缺口？

输出 JSON：
{
  "sufficient": boolean,
  "missing": ["缺失的信息描述"],
  "conflicts": ["矛盾描述"],
  "revisedQueries": ["改写后的查询"],
  "nextSources": ["建议的检索源"]
}
```

条件边逻辑：
- `sufficient === true` → generator
- `sufficient === false && iterationCount < 3` → router（用 revisedQueries 替换 routingPlan）
- `iterationCount >= 3` → generator（用已有信息尽力回答）

#### generator（生成）

构建最终 prompt：persona 系统提示 + mergedContext + chatHistory + userMessage。Streaming 生成回答，输出 token 流对接 `AgentPipelineService` 的句子缓冲和 TTS 管线。

### 2.5 延迟优化

| 策略 | 说明 |
|------|------|
| 快速路径 | analyzer 判定简单寒暄 → 跳过检索直接生成 |
| 并行检索 | `Send()` 并行分发多个检索源 |
| Streaming | generator 节点 streaming 输出，首 token 即开始 TTS |
| 迭代上限 | 硬性限制 3 次反思迭代 |
| 超时熔断 | 每个检索节点 5s 超时，超时跳过该源 |

### 2.6 Phase 2 代码改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `agent/agent.service.ts` | 重构 | 从过程式改为 LangGraph 图编译与调用 |
| `agent/graph/state.ts` | 新增 | AgenticRAGState 定义 |
| `agent/graph/nodes/analyzer.ts` | 新增 | 意图分析节点 |
| `agent/graph/nodes/router.ts` | 新增 | 智能路由节点 |
| `agent/graph/nodes/vector.ts` | 新增 | 向量检索节点（包装 KnowledgeService） |
| `agent/graph/nodes/web.ts` | 新增 | 网络搜索节点 |
| `agent/graph/nodes/memory.ts` | 新增 | 记忆检索/操作节点（包装 MemoryService） |
| `agent/graph/nodes/tool.ts` | 新增 | 通用工具执行节点 |
| `agent/graph/nodes/merge.ts` | 新增 | 信息融合节点 |
| `agent/graph/nodes/reflect.ts` | 新增 | 反思评估节点 |
| `agent/graph/nodes/generator.ts` | 新增 | 最终生成节点 |
| `agent/graph/build-graph.ts` | 新增 | 图构建与编译 |
| `agent/tools/agentic-tool.interface.ts` | 新增 | 可扩展 Tool 接口 |
| `web-search/web-search.service.ts` | 新增 | 网络搜索封装 |
| `web-search/web-search.module.ts` | 新增 | NestJS 模块 |
| `gateway/pipeline/agent-pipeline.service.ts` | 修改 | 对接 LangGraph streamEvents |
| `memory/memory.entity.ts` | 修改 | 新增 embedding 字段 |
| `supabase/migrations/` | 新增 | memory 表加 embedding 字段 |

---

## 两阶段关系

```
Phase 1                          Phase 2
┌─────────────────────┐         ┌──────────────────────────────┐
│ ConversationSummary  │ ──复用──► chatHistory 构建              │
│ MemoryService        │ ──复用──► memory 节点                   │
│ Tool Calling 意图识别 │ ──演进──► analyzer 节点（更智能的意图分析）│
│ KnowledgeService     │ ──复用──► vector 节点                   │
│ RerankerService      │ ──复用──► merge 节点                    │
└─────────────────────┘         └──────────────────────────────┘
```

Phase 1 的所有产出在 Phase 2 中以 Service 层被复用，不存在废弃代码。Phase 2 的核心新增是 LangGraph 图编排层和 web-search 模块。

---

## 配置项汇总

| 配置项 | 默认值 | 阶段 | 说明 |
| -------- | ------- | ------ | ------ |
| `SUMMARY_THRESHOLD` | 16 | Phase 1 | 触发摘要的消息数阈值 |
| `SUMMARY_RECENT_COUNT` | 6 | Phase 1 | 摘要后保留的最近消息数 |
| `WEB_SEARCH_PROVIDER` | tavily | Phase 2 | 网络搜索 API 提供商 |
| `WEB_SEARCH_API_KEY` | — | Phase 2 | 搜索 API 密钥 |
| `MAX_REFLECTION_ITERATIONS` | 3 | Phase 2 | 反思循环最大迭代次数 |
| `RETRIEVAL_TIMEOUT_MS` | 5000 | Phase 2 | 单个检索节点超时时间 |
| `MERGE_TOP_K` | 8 | Phase 2 | 信息融合后保留的 top-K 条数 |
