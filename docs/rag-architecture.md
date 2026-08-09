# RAG 链路架构梳理与问题清单

> 梳理日期：2026-08-09 ｜ 梳理对象：`digital-human-agent`（NestJS 11 + LangGraph + TypeORM + ES + Neo4j + Redis + mem0）
> 本文档目的：记录当前 RAG 链路的真实实现全貌，以及历次迭代后遗留的全部问题，作为后续稳定化工作的基线。**问题清单中的每一项在修复后应更新状态。**

---

## 1. RAG 链路全景

两条业务入口（HTTP 与 WebSocket）共用同一个 LangGraph 工作流；知识库 Search API 与 Agent 共用同一个检索端口（`RetrievalPort`）。**不存在两套平行的 RAG 实现。**

```
HTTP POST /chat ──┐                      WS conversation:text / 音频
                  ▼                                ▼
ChatController ──┐                         Gateway → Text/Audio Handler
ConversationService ─┤                      AgentPipelineService (TTS/Speak 管线)
TurnSideEffectService ──┘                          │
                  ▼                                 ▼
              AgentService.run ─→ LangGraphRagOrchestratorService (RAG_ORCHESTRATOR)
                                          │
                    ┌─────────────────────▼─────────────────────┐
                    │          LangGraph 工作流 (rag.graph)      │
                    │                                           │
                    │  START → route_question                   │
                    │    ├ none → load_context ─→ generate_answer (闲聊，跳过检索)│
                    │    ├ complex → plan_sub_questions (拆子问题)│
                    │    └ simple ─→ load_query_history (取4条历史)│
                    │                                           │
                    │  retrieve ─→ rerank ─→ evaluate_evidence  │
                    │    ↑ 证据不足：多跳循环                     │
                    │    │   (子问题/missingFacts 扩展新 query)   │
                    │    └→ web_fallback (BoCha 联网) ─→ 再评估   │
                    │                                           │
                    │  enough → load_context (persona+10条历史)  │
                    │        → load_generation_memory (短期+长期)│
                    │        → merge_memory_context → generate   │
                    └───────────────────────────────────────────┘
                          │
                TurnSideEffectService: 消息落库 + 短期记忆 append/summary
                                        + 长期记忆提取 (mem0/local)
```

### 1.1 入口层

| 路径 | 调用链 | profile | 输出 |
|---|---|---|---|
| HTTP `POST /chat` | `ChatController.chat` → `ConversationService` → `TurnSideEffectService.onTurnStart` → `AgentService.run` | 固定 `balanced_chat` | UI 流式（text-delta） |
| WS `conversation:text` / 音频 | `ConversationGateway` → `TextHandler`/`AudioHandler` → `AgentPipelineService` → `AgentService.run` | voice/digital-human 模式 → `realtime_voice` | 文本流 + 句级 TTS/数字人音频管线 |

- 两入口共享 `AgentService.run` 之后的完整 LangGraph 链路，差异仅在前置编排层。
- 一轮对话结束后的写回全部集中在 `TurnSideEffectService`：消息落库（含 citations/ragTrace/latency）、短期记忆 append + 滚动摘要 + activeContext、长期记忆 `captureFromConversation`。

### 1.2 工作流各节点实现

| 环节 | 节点 | 实现服务 | 要点 |
|---|---|---|---|
| 路由 | `route_question` | `RagRouteService` | LLM 结构化输出 simple/complex/none；问候语正则直接 none；失败/预算不足回退启发式；`profile.routeMode='heuristic'` 时跳过 LLM 省 TTFT |
| 多跳规划 | `plan_sub_questions` | `MultiHopPlannerService` | complex 拆最多 6 个子问题，失败回退原问题 |
| 检索前置 | `load_query_history` | `ConversationService` | 取最近 4 条已完成消息，仅用于 query rewrite 的追问补全 |
| 检索 | `retrieve` | `RetrievalPolicyResolver` → `QueryAugmentationService` → `QueryRewriteService` + `RetrievalPipelineService`（Port 实现） | 首跳完整 policy（LLM 改写 + keywords + 多路 query）；后续 hop 复用策略仅换 query。Port 内部：ACL epoch + cache revision → Redis 检索缓存（含 embedding 缓存 + in-flight 合并）→ `HybridRetrieverService` 每 KB 多路召回（pgvector 向量 + ES/PG 全文 + Neo4j 图谱通道）→ RRF 融合 → chunk 邻接扩展 → DataScope 权限校准；可选 `GraphExpandService` 一跳邻居扩展 |
| 重排 | `rerank` | `RerankerService` 门面 | 4 个 provider：`llm` / `dedicated`（外部 cross-encoder）/ `score`（按已有分数排序）/ `noop`，由 `profile.rerankMode` 选择；重排后推送 citations（避免粗召回闪变） |
| 证据评估 | `evaluate_evidence` | `EvidenceEvaluatorService` | LLM 判定 enough/missingFacts/webQuery；据此决定多跳继续、联网回退或直接生成；预算降级为启发式 |
| 联网回退 | `web_fallback` | `WebFallbackService` | BoCha 搜索，结果并入 citations 后重新评估，或直接进入生成 |
| 生成上下文 | `load_context` | `PersonaService` + `ConversationService` | persona + 最近 10 条历史（orchestrator 已预加载则复用） |
| 记忆 | `load_generation_memory` / `merge_memory_context` | `ShortTermMemoryService` + `MemoryRetrieverService` + `MemoryPolicyService` | 短期 = Redis 窗口 + 滚动摘要（熔断降级）；长期 = mem0 ↔ local(Postgres) 按 env 切换（熔断 + policy 过滤） |
| 生成 | `generate_answer` | `AnswerGenerationService` | 流式、wall-clock 截断、预算兜底文案；闲聊走 `generateDirect` 保留人设 |
| 收尾 | — | `TurnSideEffectService` | 见 1.1 |

### 1.3 关键设计机制

- **`RagProfile`（common/rag/rag-profile.ts）**：`realtime_voice` / `balanced_chat` / `deep_research` / `search_debug` 四档，集中控制 maxHops、allowWeb、useMultiQuery、useGraph、路由/改写/重排/评估模式与预算上限。
- **`TurnBudgetContext`（common/rag/turn-budget.context.ts）**：AsyncLocalStorage 贯穿单轮全链路的 LLM/embed 调用计数 + wall-clock 预算，所有前置 LLM 调用经 `tryConsumeAuxiliaryLlm`（保留最终 generate 额度），超限统一打 degradation flags。
- **`RetrievalPort`（knowledge/services/retrieval/pipeline/retrieval-port.ts）**：Agent 与 Search 共用的检索端口，唯一实现 `RetrievalPipelineService`。
- **双记忆体系**：短期 Redis 滑动窗口（最多 12 条）+ 滚动摘要；长期 mem0 云服务 ↔ local Postgres（`MemoryRecordEntity`），provider 由 `LONG_TERM_MEMORY_PROVIDER` env 选择，均带熔断。
- **ACL 纵深防御**：前置 = Postgres 存储过程级过滤（match_knowledge RPC 传 p_user_id/department/role）；后置 = `DataScopeService.filterKnowledgeChunks` 校准；缓存按 ACL epoch 失效。

---

## 2. 问题清单

> 所有问题均已逐项核实（含行号）。按影响分级：🔴 隐性破损 ＞ 🟠 死代码 ＞ 🟡 重复实现 ＞ 🟢 遗留抽象。
> 修复进度：① 恢复基线（A 组）+ ② 清理（B 组 + C1/C3/C5）已完成于 2026-08-09；C2/C4 与 ④ 结构性收敛（C6-C8）、⑤ 遗留抽象（D 组）待排期。

### 🔴 A. 隐性破损（最优先处理）

| # | 问题 | 位置 | 影响 | 状态 |
|---|---|---|---|---|
| A1 | **`tsc` 全量类型检查失败（9 处）**：`queryHistory` 字段加入 `RagGraphStateAnnotation` 后 spec 未同步 | `agent/langgraph/nodes/evaluation.nodes.spec.ts`（7 处）、`agent/langgraph/nodes/query.nodes.spec.ts`（1 处）、`agent/langgraph/rag.state.spec.ts`（1 处） | `pnpm build` 绿（spec 被 `tsconfig.build.json` 排除），但编辑器与 CI 的 `tsc` 全量检查红，问题被掩盖 | ✅ 已修复：spec 补 `queryHistory: []`；`package.json` 新增 `typecheck` 脚本（全量 tsc）防回归 |
| A2 | **`KnowledgeSearchService` 的 Port 为 `@Optional` 注入 + 静默空结果假实现**：`retrievalPipelineService` 未注入时回退为"永远返回空结果"的 stub（:164-172），不报任何错误 | `knowledge/services/retrieval/pipeline/knowledge-search.service.ts:161-172` | DI 配置错误时 Search API 永远返回空结果，极难排查 | ✅ 已修复：改为必注入 `RetrievalPipelineService`，移除 stub，同步 spec |

### 🟠 B. 死代码（纯删除，零行为变化）

| # | 问题 | 位置 | 说明 | 状态 |
|---|---|---|---|---|
| B1 | 3 个**未接线的记忆节点工厂** | `agent/langgraph/nodes/memory.nodes.ts:12/81/105`（`createLoadShortTermMemoryNode` / `createRetrieveLongTermMemoryNode` / `createFilterMemoryByPolicyNode`） | 功能已被 `createLoadGenerationMemoryNode` 合并，`rag.graph.ts` 未引用，仅剩定义 | ✅ 已修复：删除 3 个工厂 + 对应 spec 测试 |
| B2 | `normalizeOwnerId` 从未调用 | `conversation/controllers/chat.controller.ts:272` | — | ✅ 已修复 |
| B3 | `getLatestMessage` 从未调用 | `conversation/services/conversation.service.ts:233` | — | ✅ 已修复 |
| B4 | `DEFAULT_RAG_MAX_HOPS` 不可达 | `agent/agent.constants.ts:2`；使用点 `agent/langgraph/rag.state.ts:149` | 所有 `RagProfile` 必填 `maxHops`，兜底永不触发 | ✅ 已修复：删除常量与使用点 |
| B5 | 旧检索缓存接口 `getRetrievalChunks` / `setRetrievalChunks` | `knowledge/services/retrieval/pipeline/rag-retrieval-cache.service.ts:162/169` | 注释自认"保留旧接口供迁移"，全项目无调用者 | ✅ 已修复 |
| B6 | 旧短期记忆缓存 `getRetrievalCache` / `setRetrievalCache` | `memory/services/short-term-memory.service.ts:165/173` | 已被 `RagRetrievalCacheService` 取代，无调用者 | ✅ 已修复 |
| B7 | `hybridRetrieverService` 注入未使用 | `knowledge/services/retrieval/pipeline/knowledge-search.service.ts:153` | 注释自认"保留 hybrid 注入仅作兼容" | ✅ 已修复（随 A2 一并移除） |
| B8 | 孤儿测试文件 | `agent/retrieval-strategy.utils.spec.ts` | 无对应被测源码，测的其实是 `common/rag/retrieval-strategy.utils.ts`，应迁到 common/rag 下 | ✅ 已修复：`git mv` 至 `common/rag/` |

### 🟡 C. 重复实现（收敛）

| # | 问题 | 位置 | 说明 | 状态 |
|---|---|---|---|---|
| C1 | **启发式评估逻辑双份** | `agent/langgraph/nodes/evaluation.nodes.ts` 的 `buildHeuristicEvaluation`（:276）≡ `agent/services/evidence-evaluator.service.ts` 的 `buildFallbackEvaluation`（:200） | 阈值相同但服务版多 `graph_score*5` 因子；改一处忘另一处必漂移 | ✅ 已修复：统一为导出的 `buildFallbackEvaluation`，节点 heuristic 模式复用（顺带获得 graph_score 因子） |
| C2 | **state 冗余字段 `evidenceChunks`** | `agent/langgraph/rag.state.ts`（annotation + buildInitial + toRagWorkflowState）、`query.nodes.ts`（retrieve 写入）、`evaluation.nodes.ts`（rerank 写入）、`rag.utils.ts` `toWorkflowCitations` | 恒等于 `topDocuments`（rerank 后）或 `documents`（retrieve 后），三字段可减为两字段（`documents` + `topDocuments`） | ⬜ 待排期（有 spec 覆盖，改动面较大） |
| C3 | **长期记忆双重 policy 过滤** | `memory/services/long-term-memory.service.ts:39`（`search` 内过滤一次）+ `agent/langgraph/nodes/memory.nodes.ts:73`（`filterReadable` 再过滤一次） | 同一份记忆过滤两遍 | ✅ 已修复：保留 `search` 内过滤，节点不再二次过滤（含 graph deps/orchestrator 同步） |
| C4 | citations 入口重复包装 | `agent/langgraph/rag.state.ts:135` `getRagWorkflowCitations` 只是包了一层 `rag.utils.ts:119` `toWorkflowCitations` | — | ⬜ 待排期 |
| C5 | 恒真三元 | `agent/langgraph/nodes/evaluation.nodes.ts:58-63` `rerankMode === 'off' \|\| ... ? rerankMode : 'llm'` | 条件穷尽所有合法值，else 分支不可达 | ✅ 已修复：直接传 `rerankMode` |
| C6 | TTS 与 Speak 两条管线高度同构 | `gateway/pipeline/tts-pipeline.service.ts` vs `gateway/pipeline/speak-pipeline.service.ts` | `enqueue`/`markFinalize`/`drain`/`completeTurnIfNeeded`/`resetTurnState` 五方法逐一同构，且 speak 复用 `ttsTurnId/ttsStarted/ttsFinalizeRequested/ttsSeq` 字段（speak:54-57 vs tts:50-57） |
| C7 | Text/Audio Handler 重复模板 | `gateway/handlers/text.handler.ts:59-76` vs `audio.handler.ts:65-82` | 重复"中止旧 turn → initTurn → onTurnStart"；`MAX_USER_TEXT_LENGTH` 限制只在 TextHandler，AudioHandler 无对应限制 |
| C8 | 权限双重校验 | `gateway/conversation.gateway.ts:335` `assertMessagePermission` + `gateway/handlers/session.handler.ts:87-94` 内 `authorizationService` 再查一次 | — |

### 🟢 D. 遗留抽象（记录，可简化）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| D1 | `RAG_ORCHESTRATOR` token 间接层 | `agent/agent.constants.ts`、`agent/agent.module.ts:33-36`、`agent/agent.service.ts:33` | 唯一实现 `useExisting` 直连；`RagOrchestratorName='langgraph'` 是单值联合类型，多 orchestrator 时代遗留 |
| D2 | rag-turn-report legacy 双写 | `common/rag/rag-turn-report.ts:96` | legacy 平铺字段 + report 并存，注释自认"兼容旧前端"；`common/pipes/request-normalize.pipe.ts` 同理 |
| D3 | `resolveHttpChatProfileId` 硬编码常量函数 | `common/rag/rag-profile.ts:121`，调用点 `chat.controller.ts:122/146` | 只返回固定值，可内联 |
| D4 | `noop` rerank 模式无图路径可达 | `knowledge/services/retrieval/processing/noop-reranker.provider.ts`；`rag.state.ts` 的 `rerankMode` 联合类型不含 `'noop'` | 仅 `RERANKER_PROVIDER=noop` env 可达，属冗余 provider |
| D5 | 孤儿 spec 路径 | `agent/retrieval-strategy.utils.spec.ts` | 与 B8 同项 |

---

## 3. 稳定化路线图（待决策，未执行）

> 项目骨架健康（单一 LangGraph 编排、Port 统一、Profile/Budget 中心化、全链路降级），混乱来自迭代叠加的残留而非架构方向错误。因此方案为**清理 + 收敛 + 护栏**，不做重写。

| 步骤 | 内容 | 对应问题 | 状态 |
|---|---|---|---|
| ① 恢复护栏 | 修 3 个 spec 的 `queryHistory` 类型错误恢复 tsc 全绿；新增 `typecheck` 脚本（全量 tsc）防止回归；`KnowledgeSearchService` 的 Port 改为必注入 | A1、A2 | ✅ 2026-08-09 完成（tsc + jest 全绿） |
| ② 清理死代码 | 删除 B 组全部 8 项；删除后全量测试验证 | B1–B8 | ✅ 2026-08-09 完成 |
| ③ 收敛重复 | 合并 C1 启发式评估为单一共享函数；删除 C2 `evidenceChunks` 字段（有 spec 覆盖）；去掉 C3 双重过滤；统一 C4 citations 入口；简化 C5 恒真三元 | C1–C5 | 🔄 C1/C3/C5 已完成；C2/C4 待排期 |
| ④ 结构性收敛（可延后） | 合并 C6 TTS/Speak 管线；去重 C7 Handler 模板；收敛 C8 权限校验 | C6–C8 | ⬜ 待排期（有 WS 状态机 spec 覆盖） |
| ⑤ 遗留抽象处置 | 决定 D2 legacy 双写去留（依赖前端升级进度）；D1/D3/D4 简化 | D1–D5 | ⬜ 待排期 |

**建议**：C2/C4 可与 ④ 结构性收敛合并排期；⑤ 视前端兼容需求决定。

---

## 4. 执行记录

### 2026-08-09：数据基线 + 链路重平衡（③④）

**③ 数据基线**：新增 `scripts/analyze-rag-telemetry.ts`（`pnpm rag:telemetry [--days=N] [--profile=X] [--json]`），扫描 `conversation_message.rag_trace` 输出 stopReason / degradationFlags / 每轮 LLM 调用数 / 多跳·联网·记忆使用率画像，并对"预算不足型 stopReason × evaluate 降级"做交叉统计（验证多跳退化假设）。

**③ 结论**：当前库内仅 9 条旧格式记录（2026-06-23~07-08，无 profileId/metrics），**不足以支撑重平衡决策**。④ 以架构评审结论 + 单测为执行依据；真实环境数据积累后可重跑 `pnpm rag:telemetry` 复核。

**④ 链路重平衡**（`balanced_chat`，HTTP 主链路）：
| 变更 | 前 → 后 | 理由 |
|---|---|---|
| rerankMode | `llm` → `score` | LLM rerank 是逐 hop 成本；score provider 按 hybrid/rrf/similarity/keyword/graph 已有分数排序 + minScore 过滤，语义等价、零 LLM 成本。省下的预算留给多跳的 rewrite/evaluate |
| useLongTermMemory | `true` → `false` | 企业知识问答以知识库为准，长期记忆仅风格偏好；避免每次生成前一次 mem0/local I/O。`deep_research` 保留 `true` |
| maxLlmCalls | `5` → `6` | 预算重新分配：单跳 route+rewrite+evaluate+generate=4 次；双跳完整 6 次；三跳部分降级（现状 rerank=llm 时双跳即退化） |

**④ 双图谱合并**：删除 `RagProfile.useGraphExpand` 与 `RagWorkflowInput/State` 的 `useGraphExpand` 字段——expand 本就在 `shouldSkipGraphExpand` 内依赖 `useGraphChannel` 并带 hit≥3 阈值协调，分开配置无意义。现 `query.nodes.ts` 中 `graphExpand` 直接由 `hopStrategy.useGraph` 派生（channel 开即扩展）。

**④ 验证**：`tsc` 全绿 + 263 单测全绿（含 profile/orchestrator 断言更新）。golden-set eval 对比（`pnpm rag:eval:agent`）因 ES 未启动（`pnpm rag:preflight` elasticsearch fail）暂不可用；smoke 同理受限于环境，待 ES 就绪后补跑。
