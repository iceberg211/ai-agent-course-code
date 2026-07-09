# RAG 链路 & Agent 运行时 — 架构优化方案

| 项 | 内容 |
|----|------|
| 文档版本 | **v1.1**（纳入外部评审修正） |
| 更新日期 | 2026-07-09 |
| 范围 | `digital-human-agent` 的 LangGraph Agent 编排、检索内核、记忆、实时出口 |
| 不在范围 | 前端 UI 大改、基础设施选型更换、通用 Tool-Agent 平台化 |
| 前置状态 | 已完成：early-stop 多跳、先 route 再 memory、ACL 批量、上下文去重、citations 时机、wall-clock budget |
| 代码锚点 | `RagWorkflowInput` 仅有 `maxHops`（无 profile）；State 分散 `routeAllowWeb` / `workflowBudgetMs` / `retrievalStrategy`；HTTP/WS 共用 `AgentService.run()`；Agent 直调 `HybridRetrieverService`，Search 走 `KnowledgeSearchService` shared pipeline |

---

## 0. v1.1 相对 v1.0 的修订摘要

| 评审意见 | 方案修正 |
|----------|----------|
| 首 token P95 不可验收 | 补 **指标采集设计**：`firstTokenLatencyMs` / `llmCalls` / `embedCalls` 的埋点位置与落库字段 |
| `maxLlmCalls` 不能只写在 profile 类型里 | 引入贯穿整轮的 **`TurnBudgetContext`**（可变计数器），各 LLM 调用点扣减 |
| PR-2「替换 query-augmentation」过激 | 第一轮 **PolicyResolver 包裹** 现有 `QueryAugmentationService`，再渐进拆分 |
| Graph 拆分迁移风险 | Phase B 强制 **golden case 锁行为 → 再挪节点**；风险升为高 |
| 缓存缺权限版本来源 | Phase C 前置定义 **AclSnapshot / cache key**；`KnowledgeAccessScope` 当前无 `aclVersion` |
| RetrievalPort 另写新管线 | 明确 Phase B = **抽取 KnowledgeSearch 已有 shared pipeline**，不是重写 |
| 执行顺序 | **Profile + Report + 指标 → Policy 包裹 QA → realtime 关重能力稳定 → 再 Port** |

---

## 1. 背景与目标

### 1.1 现状一句话

系统已是可用的**企业级 Agentic RAG 对话内核**。  
下一阶段瓶颈在：**执行剖面、策略收口、可量测成本/延迟、检索路径统一**。

### 1.2 优化目标（可量化 + 可量测）

> **原则：方案里写的每一个指标，必须在 Phase A 就有采集路径，否则视为无效 KPI。**

| 目标 | 指标 | 目标值（建议） | **如何量到（必须实现）** |
|------|------|----------------|--------------------------|
| 实时体验 | 数字人路径 P95 **首 token** | ≤ 2.5s，或相对基线 ↓≥40% | 见 §5.1 `firstTokenLatencyMs` |
| 成本 | 单轮 `llmCalls` | realtime ≤ 2；balanced ≤ 5 | 见 §5.2 `TurnBudgetContext` |
| 成本 | 单轮 `embedCalls` | realtime ≤ 2；balanced ≤ 6 | 同上 + embed 埋点 |
| 总延迟 | `latencyMs`（整轮） | 持续观测，不单独作首 token 代理 | 现有字段保留 |
| 一致性 | 同 policy 下 Agent vs Search 命中 | 核心 chunk id 集合可对齐 | Phase B golden |
| 可运营 | degradation + stopReason | 100% turn | `RagTurnReport` 落库 |
| 可演进 | 新通道 | 不改主图拓扑 | RetrievalPort |

### 1.3 当前代码缺口（与目标对应）

| 缺口 | 代码现状 | 影响 |
|------|----------|------|
| 无 profile | `RagWorkflowInput` 仅 `maxHops?` | HTTP/WS 同链路 |
| 入口未分流 | `ChatController` / `AgentPipelineService` 均直接 `agentService.run()` | 数字人无法默认轻量 |
| 可绑 profile 的钩子已有 | `RealtimeSession.mode: 'voice' \| 'digital-human'` | Phase A 直接用 |
| 总延迟有、首 token 无 | 消息表 `latencyMs`；Dashboard 聚合总延迟 | 首 token SLO 不可验收 |
| ragTrace 双拼 | Controller 与 Pipeline 各自 `toRagTrace`；Dashboard 解析旧结构 | 维护成本高 |
| LLM 调用分散 | route / rewrite / rerank / evaluate / generate 各自持有 LLM | 无全局 `maxLlmCalls` 限流 |
| Agent 检索入口 | `query.nodes` → `HybridRetrieverService.retrieveForPersona` | 与 Search pipeline 分叉 |
| Search 已有 shared pipeline | `KnowledgeSearchService.retrieveWithSharedPipeline`：rewrite、hybrid、DataScope、rerank、trace | **Port 应抽取这里，勿重写** |
| ACL 版本 | chunk 上有 `aclVersion`（acl-index-refresh 写入）；`KnowledgeAccessScope` **不携带版本** | 缓存 key 无法安全拼权限快照 |

### 1.4 非目标

- 不改成通用 ReAct Tool Agent。  
- 不更换向量库 / ES / Neo4j。  
- 不以参数调优替代架构收口。  
- Phase A **不**做检索结果缓存上线（依赖权限快照设计，见 Phase C 前置条件）。

---

## 2. 问题诊断（架构视角）

### 2.1 根本矛盾

同一条运行时同时服务：实时数字人 / 企业检索正确性 / Agentic 多跳。  
缺少 **Execution Profile** → 默认「偏重、偏全」。

### 2.2 结构问题清单

| ID | 问题 | 优先级 |
|----|------|--------|
| D1 | 无执行剖面 | P0 |
| D2 | Agent 与 KnowledgeSearch 双路径 | P0 |
| D3 | 策略拼装分散 | P0 |
| D4 | 决策过度依赖通用 LLM | P1 |
| D5 | Graph 通道 vs expand 纠缠 | P1 |
| D6 | 对外契约不稳（双 toRagTrace） | P0（与 Report 绑定，提前） |
| D7 | 记忆 summary 非真压缩 | P2 |
| D8 | 缺可执行的多维预算（不仅类型字段） | P0 |
| D9 | 指标不可量测 | P0 |
| D10 | 缓存权限快照未定义 | P1（缓存上线门禁） |

### 2.3 当前主链路基线

```text
route → (plan?) → memory → retrieve → graph → rerank → evaluate
                 ↺ hop early-stop / web → context → generate
```

已有 early-stop、先 route、ACL 批量、citations 时机、wall-clock。  
仍缺 profile、可扣减 budget、统一 report、统一检索端口。

---

## 3. 目标架构

### 3.1 分层

```text
Product Entry (profile 推断)
    → Orchestration (LangGraph：控制决策)
    → RetrievalPort  ← 实现 = 抽取后的 Knowledge shared pipeline
    → Context Assembly
    → Generation + Realtime Egress
```

### 3.2 Execution Profile

```ts
type RagProfileId =
  | 'realtime_voice'
  | 'balanced_chat'
  | 'deep_research'
  | 'search_debug';

interface RagProfile {
  id: RagProfileId;
  maxHops: number;
  allowWeb: boolean;
  useMultiQuery: boolean;
  useGraphChannel: boolean;
  useGraphExpand: boolean;
  rewriteMode: 'off' | 'heuristic' | 'llm';
  rerankMode: 'off' | 'score' | 'llm' | 'dedicated';
  evaluateMode: 'off' | 'heuristic' | 'llm';
  budget: {
    wallClockMs: number;
    maxLlmCalls: number;
    maxEmbedCalls: number;
  };
}
```

| 入口 | 默认 Profile |
|------|----------------|
| WS `mode=digital-human` 或 `voice` | `realtime_voice` |
| HTTP `/chat` | `balanced_chat` |
| 显式深度检索 | `deep_research` |
| 智能搜索 / 评测 | `search_debug` |

**realtime_voice 默认（用于验证「能关掉重能力」）：**

- maxHops=1，allowWeb=false  
- rewriteMode=heuristic，rerankMode=score|off，evaluateMode=heuristic  
- wallClockMs=8000，maxLlmCalls=2，maxEmbedCalls=2  

### 3.3 RetrievalPolicy + Resolver（渐进，不一口吃）

```ts
interface RetrievalPolicy {
  profileId: RagProfileId;
  needRetrieval: boolean;
  channels: { vector: boolean; keyword: boolean; graph: boolean };
  graphExpand: boolean;
  allowWeb: boolean;
  queryCount: number;
  chunkContextWindow: number;
  topK: number;
  rerankTopK: number;
  rewriteMode: RagProfile['rewriteMode'];
  rerankMode: RagProfile['rerankMode'];
  evaluateMode: RagProfile['evaluateMode'];
  reason: string;
}
```

**落地方式（修正后）：**

1. **Phase A2**：`RetrievalPolicyResolver` 产出 policy，**内部仍调用** 现有 `QueryAugmentationService.plan()`，再把结果规范化进 policy / hop 状态。  
2. **不**在第一轮删除追问补全、rewrite、graph 判断、chunk window 等逻辑。  
3. 后续再把「策略决策」与「query 改写实现」拆文件，属于重构而非首 PR 范围。

### 3.4 TurnBudgetContext（贯穿整轮，可扣减）

> profile 上的 `maxLlmCalls` 只是**上限配置**；运行时必须有**可变上下文**。

```ts
interface TurnBudgetContext {
  readonly startedAt: number;
  readonly wallClockMs: number;
  readonly maxLlmCalls: number;
  readonly maxEmbedCalls: number;
  llmCalls: number;
  embedCalls: number;
  firstTokenAt?: number;

  remainingWallClockMs(): number;
  canCallLlm(cost?: number): boolean;
  canEmbed(cost?: number): boolean;
  recordLlm(cost?: number): void;
  recordEmbed(cost?: number): void;
  recordFirstTokenIfNeeded(): void;
  isExhausted(): boolean;
}
```

**接入点（必须改到的调用栈）：**

| 调用点 | 文件（现状） | 动作 |
|--------|----------------|------|
| route LLM | `rag-route.service.ts` | `canCallLlm` → 否则启发式 |
| rewrite LLM | `query-rewrite.service.ts` | 同上 |
| rerank LLM | `llm-reranker.provider.ts` | 同上 → score fallback |
| evaluate LLM | `evidence-evaluator.service.ts` | 同上 → heuristic |
| generate stream | `answer-generation.service.ts` | 计 1 次 llm；首 chunk 记 firstToken |
| embed | `HybridRetrieverService` / `RagRuntimeService` | `recordEmbed` |

传递方式建议（二选一，优先简单）：

1. **AsyncLocalStorage / Nest CLS** 绑定本轮 `TurnBudgetContext`（少改方法签名）；或  
2. 经 `RagWorkflowInput.budget` + LangGraph `configurable` 下传。

**禁止**：只在 evaluate 节点读 `workflowBudgetMs` 却不拦截 route/rerank 的 LLM。

### 3.5 RagTurnReport（对外稳定契约 + 双写）

```ts
interface RagTurnReport {
  profileId: RagProfileId;
  strategy: 'simple' | 'complex' | 'none';
  stopReason: string;
  citations: RagCitation[];
  degradationFlags: string[];
  metrics: {
    hops: number;
    llmCalls: number;
    embedCalls: number;
    latencyMs: number;
    firstTokenLatencyMs: number | null;
    citationCount: number;
  };
  // 兼容期保留
  legacy?: Record<string, unknown>;
  debug?: { retrievalTrace?: unknown; graphReasoningTrace?: unknown };
}
```

**落库策略（双写）：**

- `conversation_message.rag_trace` = `{ ...legacyFields, report: RagTurnReport }`  
- `latencyMs` = 整轮  
- 新增列（推荐）或 JSON 内字段：`first_token_latency_ms`、`llm_calls`、`embed_calls`、`profile_id`  
  - 若短期不迁库：全部进 `rag_trace.report.metrics`，Dashboard 改读 report  

**统一 `toRagTurnReport()`**，删除 Controller / Pipeline 两套 `toRagTrace` 拼装逻辑（或让二者都调同一函数）。

### 3.6 RetrievalPort = 抽取已有 shared pipeline

```ts
interface RetrievalPort {
  retrieve(req: RetrievalRequest): Promise<RetrievalResponse>;
}
```

**实现策略（修正后）：**

```text
KnowledgeSearchService.retrieveWithSharedPipeline
        │
        ▼ 抽取/重命名
RetrievalPipelineService implements RetrievalPort
        │
        ├── Agent retrieve 节点只调 Port
        └── KnowledgeSearchController / 智能搜索 仍走 Port（debug 包装 stageTrace）
```

- **不要**再写一套与 shared pipeline 平行的新流水线。  
- Agent 侧现有 `QueryAugmentation` 在 Phase A 可继续产出 queries；Phase B 再决定 rewrite 是否完全内聚进 Port（由 `policy.rewriteMode` 控制）。  
- `graph_reasoning` 并入 Port 的 `graphExpand` 步骤前，必须有 golden case（§6.2）。

### 3.7 上下文优先级（契约）

```text
Persona/System
  > Enterprise knowledge (ACL)
  > Conversation history
  > Long-term preference
  > Web (supplementary)
```

---

## 4. 分阶段实施计划（调整后顺序）

### 总顺序（强制）

```text
A0 指标与预算骨架
 → A1 Profile 类型 + 入口绑定
 → A2 Report 双写 + 统一 toRagTurnReport
 → A3 PolicyResolver 包裹 QueryAugmentation（不替换）
 → A4 realtime 稳定关闭 LLM eval/rerank/web/多跳
 → B0 Graph golden case 锁行为
 → B1 抽取 shared pipeline 为 RetrievalPort
 → B2 Agent 切 Port；graph 节点迁移
 → C 缓存（含 AclSnapshot）/ 专用 rerank / KB 预路由
 → D 记忆真摘要 / side-effect 协议
```

**门禁：** 未完成 A0–A2，不得启动缓存与 Port 大重构。  
**门禁：** realtime 未在预发验证「llmCalls≤2 且可回滚」，不得默认全量切数字人。

---

### Phase A — 可量测剖面与契约（约 1.5–2 周）

#### A0. 指标采集 + TurnBudgetContext（先于一切 KPI）

| 任务 | 说明 | 产出 |
|------|------|------|
| A0.1 | 实现 `TurnBudgetContext` | `src/common/rag/turn-budget.context.ts` |
| A0.2 | Orchestrator 建 context，放入 configurable / ALS | 整轮可访问 |
| A0.3 | generate 首 token：`onToken` 首次回调或 stream 首 chunk 记 `firstTokenAt` | metrics |
| A0.4 | route/rewrite/rerank/evaluate/generate/embed 埋点 | 计数可靠 |
| A0.5 | 基线跑批：当前 balanced 下 P50/P95 latency、llmCalls（无 profile） | 对比基准入库 |

**验收：** 任意一问 `report.metrics.llmCalls >= 1`（有生成时）；打断/失败路径 `firstTokenLatencyMs` 允许 null。

#### A1. RagProfile + 入口绑定

| 任务 | 说明 |
|------|------|
| A1.1 | `rag-profile.ts` 四套常量 |
| A1.2 | `RagWorkflowInput.profileId?` + orchestrator 解析 |
| A1.3 | HTTP → `balanced_chat`；WS 按 `session.mode` → `realtime_voice` |
| A1.4 | 单测：入口推断矩阵 |

#### A2. RagTurnReport 双写

| 任务 | 说明 |
|------|------|
| A2.1 | `toRagTurnReport(result, budget, profile)` |
| A2.2 | ChatController + AgentPipeline 共用 |
| A2.3 | Dashboard 读 `report.metrics`（fallback legacy） |
| A2.4 | degradationFlags：`budget_exhausted` / `rerank_degraded` / `evaluate_heuristic` 等 |

#### A3. PolicyResolver 包裹 QueryAugmentation

| 任务 | 说明 |
|------|------|
| A3.1 | Resolver 输入：profile + question + env |
| A3.2 | **内部调用** `QueryAugmentationService.plan()`，再 merge profile 约束（如 realtime 强制 maxQueries=1、allowWeb=false） |
| A3.3 | retrieve 节点消费 resolver 输出；QA 服务本身不删 |
| A3.4 | 单测：同 question 下 realtime 与 balanced 的 policy 差异 |

**估时修正：** A3 约 **2–3 天**，不是「替换 QA 的 2 天 PR」。

#### A4. realtime 能力开关验收

在 profile 驱动下验证可稳定：

- 关闭 LLM evaluate（heuristic）  
- 关闭 LLM rerank（score/off）  
- 关闭 web  
- maxHops=1  

**验收：** 数字人预发 `llmCalls` 中位数 ≤ 2；回答质量人工抽检可接受；一键回 `balanced_chat`。

**Phase A 完成标准：**

- [ ] 首 token / llmCalls / embedCalls 可从消息或 Dashboard 读出  
- [ ] Budget 能拦截至少 rerank 或 evaluate 的超额 LLM  
- [ ] 两入口 profile 绑定正确  
- [ ] Report 双写，旧前端不炸  

---

### Phase B — 抽取 shared pipeline 为 Port（约 2 周）

#### B0. Graph 行为冻结（先于挪代码）

当前同时存在：

- Hybrid **graph channel**（RRF 参与）  
- 图节点 **graph_reasoning** 后置 expand  

| 任务 | 说明 |
|------|------|
| B0.1 | Golden set：仅 channel / 仅 expand / 两者皆开 / 皆关 |
| B0.2 | 固定 chunk id 列表与 trace 字段断言 |
| B0.3 | 文档化分数来源：`retrieval_sources` 含 graph 的含义 |

**未过 B0，禁止删除 graph 节点。**

#### B1. 抽取 RetrievalPipelineService

| 任务 | 说明 |
|------|------|
| B1.1 | 从 `KnowledgeSearchService.retrieveWithSharedPipeline` 抽出核心 |
| B1.2 | 实现 `RetrievalPort`；Search 改为委托 Port + 组装 stageTrace |
| B1.3 | 保持 DataScope 只滤一次、applyAccessScope 语义不变 |

#### B2. Agent 切换 Port + Graph 配置拆分

| 任务 | 说明 |
|------|------|
| B2.1 | retrieve 节点调 Port；逐步弱化直调 Hybrid |
| B2.2 | `channels.graph` vs `graphExpand` 进 policy |
| B2.3 | 将 expand 逻辑迁入 pipeline；图上去掉 `graph_reasoning` 节点 |
| B2.4 | 跑 B0 golden + smoke agent-path |

**风险：高。** 回滚开关 `RAG_UNIFIED_RETRIEVAL_PORT=false` 走旧路径。

---

### Phase C — 成本与缓存（约 2 周，不得早于 A）

#### C0. 缓存门禁：AclSnapshot（必须先于缓存实现）

现状：`aclVersion` 写在 chunk 上，但 `KnowledgeAccessScope` 只有 `ownerId/department/role`。

**上线检索缓存前必须定义：**

```ts
interface AclSnapshot {
  // 主体侧
  ownerId: string | null;
  department: string | null;
  role: string | null;
  // 可选：用户角色 id 列表 hash
  roleIdsHash?: string;
  // 数据侧：本轮检索涉及 KB 的 max(aclVersion) 或全局 epoch
  aclEpoch: number; // 例如 max(chunk.acl_version) 参与 key，或独立 counter
}

// cache key 建议
// rag:ret:{profile}:{personaId}:{aclSnapshotHash}:{queryHash}
```

| 任务 | 说明 |
|------|------|
| C0.1 | 定义 `aclEpoch` 来源：全局 counter / per-KB max version / 查询时 max(acl_version of hit set) 不适用预缓存 |
| C0.2 | 推荐：**per knowledge_base acl_epoch**，ACL 刷新时 +1（acl-index-refresh 旁路） |
| C0.3 | `KnowledgeAccessScope` 扩展可选 `aclEpochByKb?: Record<string, number>` 或检索前批量读取 |
| C0.4 | 单测：epoch 变更后缓存必须 miss |

**未完成 C0，禁止实现 retrieval 结果缓存。** Embedding 缓存可仅对 query 文本 + model，不含 ACL（向量与权限无关），但仍建议限流。

#### C1–C3. 其余

- 专用 reranker provider  
- embedding 缓存  
- KB 预路由（多 KB 时）  
- 高峰强制 realtime profile 配置项  

---

### Phase D — 记忆与副作用（约 1 周，非首轮）

- 真滚动摘要（溢出压缩，而非 window 拼接）  
- long-term 默认不进 retrieve query  
- Turn side-effect 协议：start / evidence / token / end  

**定位：** 成立，但 ROI 低于 A/B；排在 realtime 稳定与 Port 之后。

---

## 5. 指标与预算详细设计

### 5.1 firstTokenLatencyMs

```text
turnStart = Date.now()  // ChatController / AgentPipeline 已有 startedAt
on first onToken(token):
  if budget.firstTokenAt == null:
    budget.firstTokenAt = Date.now()
firstTokenLatencyMs = firstTokenAt - turnStart  // 无 token 则为 null
```

- 生成前失败 / 纯打断无输出 → `null`  
- Dashboard：P50/P95 **仅统计 non-null**  
- **禁止**用整轮 `latencyMs` 代理首 token  

### 5.2 llmCalls / embedCalls

- 每次 `withStructuredOutput` / `stream` / `invoke` 计 1（或按实际 API 次）  
- embed 每次 `embedQuery` / batch 按条或按次（需统一约定：**按 API 调用次数**，便于对齐限流）  
- Report 与 Budget 共用同一计数器，避免两套数  

### 5.3 预算耗尽行为

| 场景 | 行为 | degradationFlag |
|------|------|-----------------|
| wall clock 尽 | 跳过后续 hop/web，进入 generate | `budget_wall_clock` |
| llmCalls 尽 | 跳过 LLM route/rewrite/rerank/eval，走启发式 | `budget_llm` |
| embedCalls 尽 | 跳过向量通道，仅 keyword/graph 或空 | `budget_embed` |

generate 本身在仍有 1 次额度时优先保留（realtime 的核心体验）。

---

## 6. 测试与验收

### 6.1 Phase A

| 用例 | 期望 |
|------|------|
| HTTP chat | profile=balanced_chat |
| WS digital-human | profile=realtime_voice |
| 一问成功 | report.metrics.llmCalls/embedCalls/firstToken 有值 |
| budget maxLlmCalls=1 | 不应再跑 LLM evaluate（flag 可见） |
| Dashboard | 能展示 firstToken 或明确「无样本」 |

### 6.2 Phase B Graph Golden

| Case | channels.graph | graphExpand | 断言 |
|------|----------------|-------------|------|
| G0 | off | off | 无 graph source |
| G1 | on | off | 有 graph 召回，无 expand 新增 id 模式 |
| G2 | off | on | 仅 expand 路径（若允许） |
| G3 | on | on | 并集；与迁移前 diff 可接受阈值 |

### 6.3 安全

- ACL deny 文档永不进 report.citations  
- 缓存（C 期）epoch 变更后必 miss  

---

## 7. 里程碑与 PR 序列（修正版）

| PR | 内容 | 预估 | 依赖 |
|----|------|------|------|
| **PR-1** | TurnBudgetContext + firstToken/llm/embed 埋点 + 基线脚本 | 2 天 | 无 |
| **PR-2** | RagProfile 类型 + 入口绑定 + Input.profileId | 1–2 天 | PR-1 |
| **PR-3** | RagTurnReport + 双写 + 统一 toRagTrace | 2 天 | PR-1 |
| **PR-4** | PolicyResolver **包裹** QueryAugmentation + profile 约束覆盖 | 2–3 天 | PR-2 |
| **PR-5** | realtime 默认关 web/llm-eval/llm-rerank/多跳 + 预发验收 | 1–2 天 | PR-4 |
| **PR-6** | Graph golden cases | 1–2 天 | 无（可并行） |
| **PR-7** | 抽取 RetrievalPort（from shared pipeline） | 3–4 天 | PR-5, PR-6 |
| **PR-8** | Agent 切 Port + graph 节点迁移 | 2–3 天 | PR-7 |
| **PR-9+** | AclSnapshot + 缓存 / dedicated rerank / KB 路由 | 按 Phase C | PR-3 完成后方可 |

**相对 v1.0 的变化：** 指标与预算前置；QA 不替换只包裹；Port 后置且基于已有 pipeline；缓存权限设计单列门禁。

---

## 8. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| KPI 写了量不到 | 高 | A0 门禁 |
| maxLlmCalls 名存实亡 | 高 | TurnBudgetContext 强制接入四类 LLM |
| QA 大爆炸重构 | 中 | 只包裹 |
| Graph 迁移行为漂移 | 高 | B0 golden + flag 回滚 |
| 缓存越权 | 高 | C0 AclSnapshot；无 epoch 不上线 |
| Port 重写两套 | 中 | 代码评审门禁：必须从 shared pipeline 抽取 |
| Dashboard 解析失败 | 中 | report 双写 + fallback legacy |

---

## 9. 成功标准（DoD）

1. **可量测**：firstToken / llmCalls / embedCalls 有采集与展示路径。  
2. **可限流**：TurnBudgetContext 能实际挡住超额 LLM/embed。  
3. **可分场景**：入口绑定 profile；realtime 默认可降重。  
4. **可运营**：统一 RagTurnReport，消灭双份 toRagTrace。  
5. **可统一检索**：Port 来自 Knowledge shared pipeline 抽取，Agent/Search 同源。  
6. **可安全缓存**（C 期）：AclSnapshot/epoch 设计落地后才有检索缓存。  

---

## 10. 附录 A：Profile 参数草案

| 参数 | realtime_voice | balanced_chat | deep_research | search_debug |
|------|----------------|---------------|---------------|--------------|
| maxHops | 1 | 2–3 | 3–4 | 1–2 |
| allowWeb | false | true | true | false |
| multiQuery | false | complex only | true | 可选 |
| graph channel | false | heuristic | true | 可选 |
| graph expand | false | 可选 | true | 可选 |
| rewrite | heuristic | heuristic/llm | llm | 与 search 一致 |
| rerank | score/off | llm/dedicated | dedicated | llm |
| evaluate | heuristic | heuristic/llm | llm | off/heuristic |
| wallClockMs | 8_000 | 20_000 | 45_000 | 30_000 |
| maxLlmCalls | 2 | 5 | 10 | 4 |
| maxEmbedCalls | 2 | 6 | 12 | 6 |

---

## 11. 附录 B：文档关系

| 文档 | 关系 |
|------|------|
| `rag_optimization_plan.md` | 历史三路召回跑通基线 |
| **本文 v1.1** | 运行时架构优化；含评审修正后的可量测与执行顺序 |
| `enterprise-kb-upgrade-execution-plan.md` | 企业 KB 升级；Port 抽取时需对齐 |

---

## 12. 结论

方案方向不变：**Phase A 的 Profile + Policy + Report + 多维预算仍是最高杠杆**。  

v1.1 把执行纪律补全为：

1. **先能量测，再谈 SLO**  
2. **Budget 是运行时对象，不是类型装饰**  
3. **Policy 先包裹 QA，再拆**  
4. **Port 抽取已有 shared pipeline，不另起炉灶**  
5. **Graph 先 golden 再搬家；缓存先 AclSnapshot 再上线**  

按修正后的 PR-1 → PR-5 做完，即可在不伤正确性的前提下验证数字人降本；再进入 Phase B 统一检索内核。
