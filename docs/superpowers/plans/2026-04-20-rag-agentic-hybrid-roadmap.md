# RAG Agentic 与混合检索演进计划

**日期**：2026-04-20  
**范围**：`digital-human-agent/`、`digital-human-agent-frontend/`  
**相关参考**：
- `docs/superpowers/specs/2026-04-17-knowledge-base-platform-design.md`
- `docs/superpowers/plans/2026-04-17-kb-phase-4-chat-integration.md`
- `digital-human-agent/RAG 知识体系.md`
- `digital-human-agent/rag-multihop.mjs`

## 计划 Review 结论

当前项目的知识库链路已经具备独立知识库、角色挂载、向量检索、rerank、命中测试等基础能力，但整体仍然偏向“单次向量检索”。下一阶段不应该直接堆 Milvus、ElasticSearch、Kibana、Web fallback、Agentic RAG，而是先让检索链路可观察，再针对失败类型逐步补技术。

调整后的顺序为：

```text
P0 契约准备 + LangSmith 诊断观测
P1 Query Rewrite 与评估对比
P2 Hybrid Retrieval 抽象
P3 ElasticSearch + Kibana BM25
P4 Agentic RAG / Multi-hop
P5 Web Fallback
P6 Redis / Milvus / Nacos 等基础设施
```

关键判断：

- **LangSmith 可以替代 P0 里的大部分自研 Trace 工作**，但前端命中测试仍需要后端返回一份简洁的本地调试摘要。
- **P0 不能直接从埋点开始**，要先定义 `RagDebugTrace`、统一命中结构和可运行评估集，否则前端、后端、评估脚本会各自理解字段。
- **评估集必须是可运行基准**，每个阶段都通过同一批 fixture 输出 hit@k、MRR、rerank 前后变化、低置信度判定，而不是靠手工观察。
- **ElasticSearch 值得接入**，它解决的是关键词、错误码、配置项、标题、专有名词命中问题。
- **Milvus 不是当前第一优先级**，现阶段可以继续用已有向量检索，先把 `VectorRetriever` 抽象留好。
- **Agentic RAG 应该在检索抽象之后做**，否则多跳检索会和当前 `KnowledgeService` 强耦合。
- **Web fallback 不能过早默认启用**，必须先有低置信度判断、来源标记和 persona 级开关。

## 总体改动目标

把当前链路：

```text
用户问题
 -> 单次向量检索
 -> rerank
 -> 拼接上下文
 -> 数字人回答
```

升级为：

```text
用户问题
 -> LangSmith 观测
 -> Query Rewrite
 -> 简单/复杂问题路由
 -> 向量检索 + BM25 关键词检索
 -> 结果融合
 -> rerank
 -> 复杂问题多跳汇总
 -> 低置信度时联网 fallback
 -> 数字人回答 + 本地/外部来源区分
```

最终达到三个目标：

- **查得准**：专有名词、错误码、配置项、标题类问题不只依赖向量检索。
- **答得全**：复杂问题可以拆成多个子问题检索，再汇总生成答案。
- **看得清**：开发期可在 LangSmith 看完整调用链，产品内命中测试可看核心检索过程。

## 影响模块

- 后端数字人回答链路：`digital-human-agent/src/agent/agent.service.ts`
- 后端知识库检索链路：`digital-human-agent/src/knowledge/knowledge.service.ts`
- 后端 rerank 服务：`digital-human-agent/src/knowledge/reranker.service.ts`
- 后端知识库配置与挂载：`digital-human-agent/src/knowledge-base/`
- 前端命中测试：`digital-human-agent-frontend/src/components/kb/tabs/HitTestTab.vue`
- 前端知识库配置：`digital-human-agent-frontend/src/components/kb/tabs/SettingsTab.vue`
- 后续新增服务：
  - `RagOrchestratorService`
  - `QueryRewriteService`
  - `HybridRetrievalService`
  - `KeywordRetriever`
  - `VectorRetriever`
  - `FusionService`
  - `QuestionRouterService`
  - `QuestionDecomposerService`
  - `WebFallbackService`
  - `ContextAssemblerService`

## 不影响模块

- 数字人形象渲染
- 语音播放与 TTS/ASR 主链路
- Persona 基础 CRUD
- 登录、用户权限基础逻辑
- 已有知识库上传入口的主交互
- 当前已修复的 embedding batch size 限制
- 前端整体导航结构

## 关键链路影响

- **命中测试链路**  
  从“展示最终命中 chunk”升级为“展示 query rewrite、检索模式、向量命中、关键词命中、融合结果、rerank 结果、fallback 判断”。

- **数字人回答链路**  
  `AgentService` 不再直接承载所有 RAG 逻辑，逐步改为调用 `RagOrchestratorService`。

- **复杂问题链路**  
  简单问题走普通 hybrid retrieval，复杂问题进入拆题、多跳检索、汇总生成。

- **知识库索引链路**  
  文档上传后不仅写入向量数据，还需要同步 ElasticSearch 索引。删除、禁用、重建知识库时也要同步处理。

- **联网 fallback 链路**  
  本地知识库低置信度或无命中时，按 persona 配置决定是否联网搜索，并将外部来源与本地引用分开。

## 风险点

- **延迟上升**：query rewrite、BM25、rerank、多跳检索、联网搜索都会增加耗时，需要按策略启用。
- **成本上升**：复杂问题拆解和 rerank 会增加模型调用次数，需要开关、阈值和日志统计。
- **来源混乱**：本地知识库和联网搜索结果必须分开标记，避免外部信息被误认为内部知识。
- **索引不一致**：数据库和 ElasticSearch 可能出现写入、删除、禁用状态不同步。
- **UI 信息过多**：命中测试需要展示关键步骤，但不能把原始日志全部堆给用户。
- **生产隐私**：LangSmith 可能记录用户问题、prompt、知识库内容，生产环境必须可关闭或脱敏。

## 验证方式

- 建立可运行 RAG 评估基准：
  - seed 文档：`digital-human-agent/eval/rag/seed-docs/`
  - seed 配置：`digital-human-agent/eval/rag/rag-eval.seed.json`
  - fixture 文件：`digital-human-agent/eval/rag/rag-eval.cases.json`
  - seed 脚本：`digital-human-agent/scripts/rag-seed-eval.ts`
  - 执行脚本：`digital-human-agent/scripts/rag-eval.ts`
  - seed 命令：`npm run rag:seed-eval`
  - npm 命令：`npm run rag:eval`
  - 检索指标：`hit@1`、`hit@3`、`hit@5`、`MRR`、`expectedHitSelectors` 命中率、rerank 前后排名变化、低置信度判断准确率
  - 答案指标：通过 `npm run rag:eval-answer` 单独评估 `expectedAnswerPoints`
- fixture 覆盖问题类型：
  - 专有名词、错误码、配置项
  - 文档标题、章节标题
  - 普通语义问题
  - 复杂多跳问题
  - 知识库无资料问题
  - 多轮对话省略指代问题
- 每个阶段都用同一批 fixture 生成 baseline 对比报告。
- 后端验证：

```bash
cd digital-human-agent
npm run build
npm test
npm run test:e2e
```

- 前端验证：

```bash
cd digital-human-agent-frontend
npm run type-check
npm run build
```

- LangSmith 验证：
  - 能看到一次数字人回答的完整调用链。
  - 能看到 query rewrite、retrieval、rerank、generate 等节点。
  - 能按 `personaId`、`knowledgeBaseIds`、`retrievalMode` 查询 trace。

---

## 核心实施契约

下面这些契约先于具体功能开发。P0 的第一步不是直接接 LangSmith，而是先让后端、前端、评估脚本使用同一套字段。

### 1. `RagDebugTrace` 调试摘要

后端所有 RAG 入口都返回同一类调试摘要，前端根据 `chainType` 和 `stages` 决定展示哪些区域。

```ts
type RagChainType = 'kb_hit_test' | 'persona_retrieval' | 'agent_answer';
type RetrievalMode = 'vector' | 'keyword' | 'hybrid';
type RetrievalOrigin = 'vector' | 'keyword' | 'web';
type RetrievalRankStage = 'raw' | 'fusion' | 'rerank';
type ConfidenceMethod = 'none' | 'vector_similarity' | 'keyword_bm25_normalized' | 'hybrid_rerank' | 'llm_relevance';
type RagStageName =
  | 'query_rewrite'
  | 'vector_retrieval'
  | 'keyword_retrieval'
  | 'fusion'
  | 'rerank'
  | 'multi_hop'
  | 'web_fallback'
  | 'context_assembly'
  | 'generation';

interface RagDebugTrace {
  traceId: string;
  langsmithRunId?: string;
  chainType: RagChainType;
  personaId?: string;
  knowledgeBaseIds: string[];
  originalQuery: string;
  rewrittenQuery?: string;
  retrievalMode: RetrievalMode;
  lowConfidence: boolean;
  lowConfidenceReason?: string;
  confidence: ConfidenceTrace;
  stages: RagStageTrace[];
  hits: RetrievalHit[];
  rerank?: RerankTrace;
  multiHop?: MultiHopTrace;
  fallback?: FallbackTrace;
  timingsMs: Record<string, number>;
  createdAt: string;
}

interface ConfidenceTrace {
  finalConfidence: number;
  threshold: number;
  method: ConfidenceMethod;
  signals: {
    topSimilarity?: number;
    topBm25Score?: number;
    normalizedBm25?: number;
    topFusionScore?: number;
    topRerankScore?: number;
    llmRelevant?: boolean;
    supportingHits?: number;
  };
}

interface RagStageTrace {
  name: RagStageName;
  input?: unknown;
  output?: unknown;
  skipped?: boolean;
  skipReason?: string;
  latencyMs?: number;
}

interface RetrievalHit {
  id: string;
  chunkId?: string;
  documentId?: string;
  knowledgeBaseId?: string;
  chunkIndex?: number;
  title?: string;
  sourceName?: string;
  sourceUrl?: string;
  content: string;
  contentPreview: string;
  sources: RetrievalOrigin[];
  rankStage: RetrievalRankStage;
  rank: number;
  originalRanks?: Partial<Record<RetrievalOrigin, number>>;
  score?: number;
  similarity?: number;
  bm25Score?: number;
  fusionScore?: number;
  rerankScore?: number;
  metadata?: Record<string, unknown>;
}

interface RerankTrace {
  enabled: boolean;
  model?: string;
  before: Array<{ id: string; rank: number; score?: number }>;
  after: Array<{ id: string; rank: number; rerankScore?: number }>;
}

interface MultiHopTrace {
  enabled: boolean;
  subQuestions: string[];
  hops: Array<{
    index: number;
    query: string;
    rewrittenQuery?: string;
    reason?: string;
    hits: RetrievalHit[];
    lowConfidence: boolean;
  }>;
}

interface FallbackTrace {
  enabled: boolean;
  used: boolean;
  reason?: string;
  policy: 'never' | 'low_confidence' | 'user_confirmed' | 'realtime_only';
  externalSources: RetrievalHit[];
}
```

P0 阶段的默认值：

- `rewrittenQuery` 默认等于 `originalQuery`。
- `retrievalMode` 默认 `vector`。
- `confidence.finalConfidence` 默认取 top1 similarity；无命中时为 `0`。
- `keyword_retrieval`、`fusion`、`multi_hop`、`web_fallback` 阶段可以先标记为 `skipped: true`。
- `multiHop.enabled` 默认 `false`，`subQuestions` 和 `hops` 为空数组。
- `fallback.used` 默认 `false`。
- P0 的本地命中统一使用 `sources: ['vector']`；如果 rerank 生效，最终命中的 `rankStage` 为 `rerank`，但 `sources` 仍保留原始来源。
- 单 KB 命中测试和 persona 聚合检索必须返回完整 `content` 与 `chunkIndex`，保证现有命中详情区可以等价迁移；数字人回答链路后续如需脱敏，可另加 `includeFullContent=false` 参数。
- 单 KB 命中测试使用 `chainType: 'kb_hit_test'`，`knowledgeBaseIds` 只有一个值。
- persona 聚合检索使用 `chainType: 'persona_retrieval'`，需要有 `personaId` 和多个 `knowledgeBaseIds`。
- 数字人回答使用 `chainType: 'agent_answer'`，后续可补 `generation` 阶段。

### 2. 可运行 RAG 评估基准

评估集放在后端项目内，先用 seed 文档 + JSON fixture，不依赖外部平台。评估不能依赖数据库自动生成的 UUID；每次本地重建或 CI 执行时，先通过 seed 脚本创建固定 persona、知识库和文档，再用稳定选择器判断命中。

seed 配置示例：

```json
{
  "datasetId": "rag-eval-default",
  "personas": [
    {
      "key": "persona-dev-assistant",
      "name": "开发助手"
    }
  ],
  "knowledgeBases": [
    {
      "key": "kb-rag-course",
      "name": "RAG 课程评估库",
      "attachToPersonaKeys": ["persona-dev-assistant"],
      "documents": [
        {
          "sourceName": "embedding-batch-limit.md",
          "path": "eval/rag/seed-docs/embedding-batch-limit.md",
          "category": "rag"
        }
      ]
    }
  ]
}
```

fixture 示例：

```json
[
  {
    "id": "kb-error-code-001",
    "category": "keyword",
    "query": "batch size is invalid 不超过 10 是什么问题？",
    "personaKey": "persona-dev-assistant",
    "knowledgeBaseKeys": ["kb-rag-course"],
    "history": [],
    "expectedHitSelectors": [
      {
        "sourceName": "embedding-batch-limit.md",
        "chunkIndex": 0,
        "contentSha256": "sha256:optional-seed-generated-hash",
        "contentIncludes": "OpenAIEmbeddings 的 batchSize 需要小于等于 10"
      }
    ],
    "expectedAnswerPoints": [
      "embedding 批量大小超过供应商限制",
      "batchSize 需要小于等于 10",
      "应在 OpenAIEmbeddings 配置中限制 batchSize"
    ],
    "shouldTriggerFallback": false,
    "expectedLowConfidence": false
  }
]
```

脚本约定：

```bash
cd digital-human-agent
npm run rag:seed-eval
npm run rag:eval -- --seed
npm run rag:eval
npm run rag:eval -- --case kb-error-code-001
npm run rag:eval -- --mode vector
npm run rag:eval -- --mode hybrid
```

输出报告至少包含：

- `hit@1`、`hit@3`、`hit@5`
- `MRR`
- `expectedHitSelectors` 是否命中
- rerank 前后目标 chunk 排名变化
- `lowConfidence` 与 `shouldTriggerFallback` 判定是否正确
- 每个 case 的 `traceId` 和 `langsmithRunId`

### 3. `retrieval_config` v2

`retrieval_config` 是知识库级配置，只描述这个 KB 内部如何检索、融合和 rerank。它不包含 query rewrite、multi-hop、web fallback 这类 persona/agent 编排策略。

```json
{
  "schemaVersion": 2,
  "retrievalMode": "hybrid",
  "threshold": 0.6,
  "vectorTopK": 20,
  "keywordTopK": 20,
  "candidateLimit": 40,
  "finalTopK": 5,
  "rerank": true,
  "confidence": {
    "keywordBm25SaturationScore": 12,
    "minSupportingHits": 1
  },
  "fusion": {
    "method": "rrf",
    "rrfK": 60,
    "vectorWeight": 1,
    "keywordWeight": 1
  }
}
```

迁移规则：

- 旧配置没有 `schemaVersion` 时视为 v1。
- `stage1TopK` 迁移为 `vectorTopK`。
- `finalTopK`、`threshold`、`rerank` 保持原值。
- `retrievalMode` 默认 `vector`，避免升级后行为突然变化。
- `keywordTopK` 默认等于 `vectorTopK`。
- `candidateLimit` 默认 `vectorTopK + keywordTopK`。
- `confidence.keywordBm25SaturationScore` 默认 `12`。
- `confidence.minSupportingHits` 默认 `1`。
- DTO 和前端类型要同步更新，配置 UI 不应写入后端不认识的字段。

### 4. `ragPolicy` v1

`ragPolicy` 是 persona 或 agent 级策略，描述一次回答如何编排多个知识库、是否改写、是否多跳、是否联网。一个 persona 挂多个 KB 时，编排层只读取 persona 的 `ragPolicy`，不会从多个 KB 的配置里合并策略。

```json
{
  "schemaVersion": 1,
  "minConfidence": 0.45,
  "queryRewrite": {
    "enabled": false,
    "historyTurns": 4
  },
  "multiHop": {
    "enabled": false,
    "maxSubQuestions": 4,
    "maxRetrievals": 4
  },
  "webFallback": {
    "enabled": false,
    "policy": "never",
    "requireConfirmation": true
  }
}
```

策略归属规则：

- KB 级 `retrieval_config`：`retrievalMode`、`threshold`、`vectorTopK`、`keywordTopK`、`candidateLimit`、`finalTopK`、`rerank`、`fusion`、关键词置信度归一参数。
- persona/agent 级 `ragPolicy`：`minConfidence`、`queryRewrite`、`multiHop`、`webFallback`、`requireConfirmation`。
- persona 同时挂载多个 KB 时，每个 KB 先按自己的 `retrieval_config` 召回候选；统一融合、低置信度判断、fallback 是否触发由 persona 的 `ragPolicy` 决定。

### 5. 低置信度判定

所有检索路径最后都必须输出 `ConfidenceTrace.finalConfidence`，范围固定为 `0-1`。`lowConfidence = finalConfidence < ragPolicy.minConfidence`。

初始规则：

- 无命中：`finalConfidence = 0`，`method = 'none'`。
- `vector`：`finalConfidence = topSimilarity`，`method = 'vector_similarity'`。
- `keyword`：`finalConfidence = min(1, topBm25Score / keywordBm25SaturationScore)`，`method = 'keyword_bm25_normalized'`。
- `hybrid + rerank`：如果 rerank 模型返回 `0-1` 分数，`finalConfidence = topRerankScore`，`method = 'hybrid_rerank'`。
- `hybrid` 但无归一化 rerank 分数：`finalConfidence = max(topSimilarity ?? 0, normalizedBm25 ?? 0)`，并记录 `topFusionScore` 只用于排序解释，不直接当置信度。
- 后续如接 LLM relevance check，只能写入 `method = 'llm_relevance'`，并在 `signals.llmRelevant` 里保留判断结果。

注意：

- `fusionScore` 只表示排序融合结果，不能直接和 similarity、BM25、rerankScore 比较。
- `threshold` 是 KB 内召回过滤阈值，`minConfidence` 是 persona/agent 级 fallback 判定阈值。
- `minSupportingHits` 用于要求至少有几个候选支撑答案，不替代 `finalConfidence`。

### 6. 答案评估策略

评估拆成两层，避免把检索质量和生成质量混在一起。

第一阶段只评估检索：

- P0/P2/P3 默认只看 `expectedHitSelectors`、`hit@k`、`MRR`、rerank 排名变化、低置信度判断。
- `expectedAnswerPoints` 可以保留在 fixture 中，但不参与默认通过条件。

第二阶段再评估答案：

- 新增 `npm run rag:eval-answer`。
- judge 策略可选：
  - `literal`：字符串包含，用于错误码、配置名、函数名。
  - `regex`：正则匹配，用于格式可变但关键词稳定的答案。
  - `llm_judge`：LLM-as-judge，用于中文同义改写和综合答案。
- `llm_judge` 必须固定 prompt、模型、温度、通过阈值，并输出每个 answer point 的通过/失败原因。
- answer eval 不作为 P0/P2/P3 的硬性门槛，等 P4/P5 涉及最终生成质量时再纳入。

### 7. ElasticSearch 一致性策略

P3 不直接把 ES 写入塞进上传流程里结束，需要有幂等、重建、对账和事务边界设计。

最小实现：

- 数据库写入/删除和 ES outbox 任务创建必须在同一个数据库事务里提交。
- ES worker 只消费已提交的 `pending` 任务。
- ES 文档 `_id` 使用 `chunkId`，重复写入同一个 chunk 是覆盖更新。
- 索引名使用别名，例如 `knowledge_chunks_current`，便于后续重建切换。
- chunk payload 包含 `chunkId`、`documentId`、`knowledgeBaseId`、`enabled`、`content`、`title`、`source`、`metadata`、`updatedAt`。
- 新增索引任务记录，至少包含：
  - `eventType`: `chunk.upsert`、`chunk.delete`、`document.delete`、`kb.delete`、`kb.reindex`
  - `chunkId`（批量删除任务可为空）
  - `documentId`
  - `knowledgeBaseId`
  - `payload`
  - `status`: `pending`、`processing`、`synced`、`failed`
  - `attempts`
  - `lastError`
- 任务执行失败不回滚数据库写入，而是标记 `failed` 并允许重试。
- 删除文档前，应用层必须先查询该 document 下的 chunk id，并在同一个数据库事务内创建 `chunk.delete` 任务；如果无法逐条拿到 chunk id，则创建 `document.delete` 任务并用 ES `delete_by_query` 按 `documentId` 删除。
- 删除知识库前，应用层必须先在同一个数据库事务内创建 `kb.delete` 任务并用 ES `delete_by_query` 按 `knowledgeBaseId` 删除；删除后 `es:check` 仍要验证没有残留。
- 禁用 chunk 可以写入 `chunk.upsert` 并同步 `enabled=false`，也可以写入 `chunk.delete`；第一版需要固定一种策略，避免 ES 查询层和数据库语义不一致。
- 提供重建命令：

```bash
cd digital-human-agent
npm run es:reindex -- --kbId <knowledgeBaseId>
npm run es:check -- --kbId <knowledgeBaseId>
```

对账规则：

- 数据库 enabled chunk 数量应等于 ES 中对应 KB 的可检索文档数量。
- 抽样比较 `updatedAt`，发现 ES 旧于数据库时触发重建。
- 删除 KB 后，ES 中不应再存在该 `knowledgeBaseId` 的文档。

### 8. Web Fallback 回答策略

Web fallback 是外部补充信息，不是 persona 私有知识库的一部分。

策略规则：

- 默认本地知识优先。本地命中置信度足够时，不触发联网。
- 本地知识与外部资料冲突时，默认以本地知识为准，并提示外部资料存在差异。
- 明显实时信息问题可以允许外部资料优先，但必须在答案里说明来源时间和来源链接。
- `policy: 'user_confirmed'` 时，数字人需要先请求用户确认，再联网。
- 实时信息识别先用规则判断，例如“今天、最新、价格、版本、新闻、官网当前”，规则不确定时再用模型分类。
- 外部资料只进入 `externalSources`，不写入知识库，不进入 persona 长期知识语境。
- prompt 中要明确分区：
  - `localKnowledgeContext`
  - `externalSearchContext`
  - `sourceConflictNotes`

---

## P0：契约准备 + LangSmith 诊断观测

### 改动目标

先定义 `RagDebugTrace` 和评估 fixture，再接入 LangSmith，让 RAG 链路在开发期可观察。同时命中测试接口返回一份轻量本地调试摘要，供前端展示。

### 影响模块

- `AgentService`
- `KnowledgeService`
- `RerankerService`
- 后续新增 `RagOrchestratorService`
- persona/agent 级 `ragPolicy` 配置
- 命中测试接口
- 命中测试前端 UI
- `digital-human-agent/eval/rag/seed-docs/`
- `digital-human-agent/eval/rag/rag-eval.seed.json`
- `digital-human-agent/eval/rag/rag-eval.cases.json`
- `digital-human-agent/scripts/rag-seed-eval.ts`
- `digital-human-agent/scripts/rag-eval.ts`

### 不影响模块

- 文档上传与切分
- embedding 生成与批处理
- 知识库 CRUD
- Persona 挂载知识库
- 数字人形象和语音链路

### 关键链路影响

- 后端先统一返回 `RagDebugTrace`，前端不直接依赖 LangSmith API。
- 评估脚本先根据 seed 配置创建可复现测试数据，再读取 fixture，调用现有命中测试或检索服务，输出当前 baseline。
- 每次数字人回答生成 LangSmith trace。
- 每次命中测试生成 LangSmith trace。
- trace metadata 至少包含：
  - `personaId`
  - `knowledgeBaseIds`
  - `sessionId`
  - `retrievalMode`
  - `originalQuery`
  - `rewrittenQuery`
  - `topK`
  - `rerankEnabled`
- 命中测试接口返回简洁摘要：
  - `RagDebugTrace.originalQuery`
  - `RagDebugTrace.rewrittenQuery`
  - `RagDebugTrace.retrievalMode`
  - `RagDebugTrace.hits`
  - `RagDebugTrace.rerank`
  - `RagDebugTrace.confidence`
  - `RagDebugTrace.lowConfidence`

### 风险点

- LangSmith 会记录 prompt、用户输入、检索内容，生产环境必须有开关。
- trace 内容过多会增加排查成本，需要控制 metadata 字段。
- 流式回答要确认 trace 能完整记录最终输出。
- 本地命中测试摘要不能依赖 LangSmith API，否则前端调试会受外部服务影响。
- 评估 seed 脚本需要保证幂等；重复执行不能创建重复 persona、知识库、文档或 chunk。
- 评估 fixture 使用 `personaKey`、`knowledgeBaseKeys` 和 `expectedHitSelectors`，不要依赖数据库自动生成的 UUID。

### 验证方式

- `npm run rag:seed-eval` 能幂等创建评估数据。
- `npm run rag:eval` 能跑完并输出 baseline 指标。
- 命中测试接口返回 `RagDebugTrace`，字段符合核心实施契约。
- 低置信度判断只读取 `RagDebugTrace.confidence.finalConfidence`，不直接比较 similarity、BM25、fusionScore。
- 配置环境变量：

```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your-api-key
LANGSMITH_PROJECT=digital-human-agent-rag
```

- 执行一次知识库命中测试，在 LangSmith 看到 retrieval 和 rerank。
- 执行一次数字人问答，在 LangSmith 看到完整回答链路。
- 关闭 `LANGSMITH_TRACING` 后，本地功能仍然可用。
- 前端命中测试能展示本地调试摘要。

---

## P1：Query Rewrite 与评估对比

### 改动目标

解决多轮对话中的省略、指代和口语化问题，让检索 query 更完整。同时建立固定评估问题集，后续每个 RAG 改动都能做前后对比。

### 影响模块

- `AgentService`
- 新增 `QueryRewriteService`
- 后续 `RagOrchestratorService`
- persona/agent 级 `ragPolicy.queryRewrite`
- 命中测试接口
- LangSmith metadata
- `rag-eval` 评估脚本

### 不影响模块

- 文档上传
- chunk 切分
- 向量索引
- ElasticSearch 接入
- Web fallback

### 关键链路影响

- 检索前先将用户问题改写为完整检索问题。
- 对话场景中可利用最近 N 轮历史。
- query rewrite 是否启用由 persona/agent 级 `ragPolicy.queryRewrite.enabled` 决定。
- 命中测试允许用户查看：
  - `originalQuery`
  - `rewrittenQuery`
  - 是否使用历史消息
- LangSmith 中将 query rewrite 作为独立 span。
- 评估脚本分别跑 `rewrite=false` 和 `rewrite=true`，输出改写前后命中指标差异。

### 风险点

- LLM 改写可能过度发挥，改变用户原意。
- 改写增加一次模型调用，影响延迟。
- 对简单问题不一定需要改写，需要短路策略。

### 验证方式

- 用多轮问题测试：
  - “这个怎么配置？”
  - “那报错怎么办？”
  - “它和上面那个有什么区别？”
- 比较改写前后的 topK 命中。
- 检查 LangSmith 中 rewrite 输入输出是否合理。
- 保证普通单轮问题不会被明显改坏。
- `npm run rag:eval -- --rewrite=false` 与 `npm run rag:eval -- --rewrite=true` 的报告可对比。

---

## P2：Hybrid Retrieval 抽象

### 改动目标

先抽象混合检索架构，为后续 ElasticSearch 和 Milvus 留接口。第一版可以继续使用现有向量检索，并用数据库关键词检索或简单 BM25 替代实现验证流程。

### 影响模块

- `KnowledgeService`
- `RerankerService`
- `retrieval_config` v2 迁移
- 新增 `HybridRetrievalService`
- 新增 `VectorRetriever`
- 新增 `KeywordRetriever`
- 新增 `FusionService`
- 知识库配置 UI
- 命中测试 UI

### 不影响模块

- ElasticSearch 部署
- Kibana 调试
- Milvus 接入
- Web fallback
- 复杂问题拆解

### 关键链路影响

- 先落地 `retrieval_config` v2 迁移、DTO 和前端类型。
- 检索入口从“只调向量检索”改成“按配置选择检索模式”：
  - `vector`
  - `keyword`
  - `hybrid`
- hybrid 模式下并发执行：
  - 向量检索
  - 关键词检索
- 使用 RRF 或加权融合合并结果。
- rerank 对融合后的候选集统一重排。
- 命中测试展示结果来源与排序阶段：
  - `sources: ['vector']`
  - `sources: ['keyword']`
  - `sources: ['vector', 'keyword']`
  - `rankStage: 'fusion'`
  - `rankStage: 'rerank'`
- `RagDebugTrace` 中每个 `RetrievalHit` 同时标明 `sources` 和 `rankStage`，前端不通过分数猜来源，也不会在 rerank 后丢失原始来源。

### 风险点

- 不同检索来源的分数不可直接比较，需要融合算法。
- 候选集过大时 rerank 成本升高。
- 关键词检索第一版如果太简陋，可能误判 hybrid 的价值。
- 配置迁移不完整会导致旧知识库行为变化，需要默认 `retrievalMode: 'vector'`。

### 验证方式

- 使用专有名词、错误码、配置项问题测试 keyword 召回。
- 使用语义问题测试 vector 召回。
- 使用混合问题测试 hybrid 是否优于单一路径。
- 检查 rerank 后第一名是否更相关。
- 检查 `ConfidenceTrace.finalConfidence` 在 vector、keyword、hybrid 三种模式下都落在 `0-1`。
- `npm run rag:eval -- --mode vector` 与 `npm run rag:eval -- --mode hybrid` 输出同一套指标。
- 更新 DTO、前端类型和配置 UI 后，旧配置仍能正常读取。

---

## P3：ElasticSearch + Kibana BM25

### 改动目标

把关键词检索升级为正式 BM25，使用 ElasticSearch 承担全文检索，Kibana 用于索引、分词、查询调试。

### 影响模块

- Docker Compose
- 新增 ElasticSearch 配置
- 新增 Kibana 配置
- ES outbox 任务表或任务实体
- `KeywordRetriever`
- 文档上传后的索引同步
- 文档删除、禁用、重建后的索引同步
- 知识库命中测试 UI

### 不影响模块

- 当前向量检索实现
- 当前 rerank 接口
- Query Rewrite
- Agentic RAG 拆题逻辑
- Web fallback

### 关键链路影响

- 新增 `knowledge_chunks` 索引。
- 数据库写入/删除与 ES outbox 任务创建必须在同一个数据库事务中提交。
- ES worker 只消费已提交的 `pending` 任务。
- chunk 写入数据库后创建 ES 索引任务，由任务执行器同步 ES。
- chunk 禁用、删除、重建时创建对应 ES 任务；文档或知识库删除必须覆盖数据库级联删除场景。
- ES 文档 `_id` 固定为 `chunkId`，写入、重试、重建都必须幂等。
- 文档删除优先在删除前批量创建 `chunk.delete`；无法逐条创建时使用 `document.delete` + `delete_by_query`。
- 知识库删除使用 `kb.delete` + `delete_by_query`，删除后用 `es:check` 验证无残留。
- 提供 `es:reindex` 和 `es:check` 命令，用于重建和对账。
- `KeywordRetriever` 从数据库关键词检索切换为 ES BM25。
- Kibana 用于查看：
  - mapping
  - analyzer
  - query DSL
  - 命中文档
  - score 解释

### 风险点

- ES 与数据库索引状态不一致。
- 中文分词如果配置不当，BM25 效果会很差。
- Docker 环境会增加启动成本。
- 删除知识库时必须处理 ES 残留数据。
- 索引任务重试需要限制次数，并记录 `lastError`，否则失败会被静默吞掉。
- 如果数据库变更和 outbox 任务没有同事务提交，应用崩溃时会留下 ES 残留或漏索引。

### 验证方式

- 上传文档后确认 ES 索引存在对应 chunk。
- 删除或禁用 chunk 后确认 ES 不再返回该内容。
- `npm run es:check -- --kbId <knowledgeBaseId>` 能发现数据库和 ES 数量不一致。
- `npm run es:reindex -- --kbId <knowledgeBaseId>` 能重建该知识库索引。
- 在 Kibana 中用标题、错误码、配置项测试 BM25。
- 命中测试中比较 vector、keyword、hybrid 三种模式。

---

## P4：Agentic RAG / Multi-hop

### 改动目标

吸收 `digital-human-agent/rag-multihop.mjs` 的思路，把复杂问题拆成多个子问题逐步检索，再统一汇总回答。

### 影响模块

- `AgentService`
- 新增 `RagOrchestratorService`
- 新增 `QuestionRouterService`
- 新增 `QuestionDecomposerService`
- persona/agent 级 `ragPolicy.multiHop`
- `HybridRetrievalService`
- `ContextAssemblerService`
- LangSmith trace
- 命中测试 UI

### 不影响模块

- 文档上传
- ES 索引同步
- Persona 基础管理
- 数字人形象和语音链路

### 关键链路影响

- 问题先进入路由：
  - 简单问题走普通 hybrid retrieval。
  - 复杂问题进入 multi-hop。
- 复杂问题拆成 2-5 个子问题。
- 每个子问题调用 `HybridRetrievalService`。
- 子问题命中结果去重、合并、rerank。
- 最后根据累计上下文生成回答。
- 每个子问题写入 `RagDebugTrace.multiHop.hops`，前端和评估脚本不读取 `stages.input/output` 里的临时结构。
- LangSmith 展示每个子问题的检索 span。

### 风险点

- 拆题质量直接影响最终答案。
- 多跳检索延迟更高，不能默认所有问题都走。
- 子问题过多会导致上下文膨胀。
- 汇总回答可能混合多个来源，需要清晰引用。

### 验证方式

- 测试复杂问题：
  - “对比这两个方案，并结合项目当前架构给出迁移步骤。”
  - “先解释错误原因，再说明配置位置和验证方式。”
  - “根据 A 文档和 B 文档，整理完整流程。”
- LangSmith 中能看到 route、decompose、每个 retrieve、final generate。
- 前端命中测试能从 `RagDebugTrace.multiHop` 展示子问题和各自命中。
- 简单问题不会进入 multi-hop。

---

## P5：Web Fallback

### 改动目标

当本地知识库无命中或低置信度时，按 persona 策略决定是否联网搜索，并在答案中明确区分本地知识和外部来源。

### 影响模块

- `RagOrchestratorService`
- 新增 `WebFallbackService`
- persona/agent 级 `ragPolicy.webFallback`
- 命中测试 UI
- 数字人回答 prompt
- LangSmith trace

### 不影响模块

- 文档上传
- ES 索引同步
- 向量检索接口
- BM25 检索接口

### 关键链路影响

- 本地检索后增加低置信度判断：
  - 无命中
  - `ConfidenceTrace.finalConfidence` 低于 `ragPolicy.minConfidence`
  - rerank 后仍不相关
  - 问题明显需要实时信息
- persona 增加策略：
  - 是否允许联网
  - 是否优先本地知识库
  - 是否需要用户确认
- 联网结果作为 `externalSources`，不混入本地 `citations`。
- 本地知识与外部搜索冲突时，默认以本地知识为准，并在回答中提示差异。
- 实时信息问题可允许外部资料优先，但必须明确来源和时间。
- 外部资料不写入知识库，也不进入 persona 长期知识语境。

### 风险点

- 联网结果质量不稳定。
- 外部资料可能与本地知识冲突。
- 搜索 API 有速率和成本限制。
- 数字人需要明确说明哪些内容来自外部。
- 实时信息识别如果只靠模型，可能误触发联网；需要规则优先、模型兜底。

### 验证方式

- 本地知识库有资料时不触发 fallback。
- 本地知识库无资料时按策略触发 fallback。
- 禁用联网的 persona 不触发 fallback。
- 答案中本地来源和外部来源显示分明。
- LangSmith 中能看到 fallback 触发原因。
- 构造本地知识与外部资料冲突的 case，确认回答不会把外部资料写成本地结论。

---

## P6：Redis / Milvus / Nacos 等基础设施

### 改动目标

在主检索链路稳定后，再补基础设施。优先考虑对当前项目收益明确的组件。

### 影响模块

- Docker Compose
- 文档处理任务
- 向量检索适配层
- 配置管理
- 后续部署脚本

### 不影响模块

- Query Rewrite
- Hybrid Retrieval 核心接口
- Agentic RAG 核心流程
- Web fallback 策略

### 关键链路影响

- Redis 可用于文档解析、embedding、ES 同步的异步任务队列。
- Milvus 可作为 `VectorRetriever` 的一个实现，不替换业务接口。
- Nacos 仅在服务拆分后考虑，不作为当前必要项。

### 风险点

- 基础设施过早引入会增加开发和调试成本。
- Milvus 迁移需要重新导入向量数据。
- Nacos 对当前单体项目收益有限。
- Redis 队列需要处理失败重试和幂等。

### 验证方式

- Redis 任务失败可重试，重复执行不会产生重复 chunk。
- Milvus retriever 与现有向量检索返回结构一致。
- 关闭 Milvus 时可回退到当前向量检索。
- Docker Compose 能一键启动开发依赖。

---

## 推荐实施顺序

第一阶段先做：

```text
P0 契约准备 + LangSmith 诊断观测
P1 Query Rewrite 与评估对比
```

这两项先定义统一调试结构和可运行评估基准，再接 LangSmith 与 query rewrite。完成后，后续 hybrid、ES、multi-hop 都能用同一批指标做对比。

第二阶段做：

```text
P2 Hybrid Retrieval 抽象
P3 ElasticSearch + Kibana BM25
```

先抽象，再接 ES，避免后续把检索逻辑写死在 `KnowledgeService`。

第三阶段做：

```text
P4 Agentic RAG / Multi-hop
P5 Web Fallback
```

先让复杂问题能多步检索，再处理本地知识库没有资料的情况。

第四阶段做：

```text
P6 Redis / Milvus / Nacos 等基础设施
```

这些能力等主链路稳定后再补，避免基础设施先于问题本身。

## 下一步执行建议

从 P0 开始，先完成以下最小改动：

- 定义 `RagDebugTrace`、`RetrievalHit`、`ConfidenceTrace`、`RerankTrace`、`MultiHopTrace`、`FallbackTrace` 类型。
- 定义 KB 级 `retrieval_config` v2 和 persona/agent 级 `ragPolicy` v1 的归属边界。
- 命中测试接口返回 `RagDebugTrace`，P0 暂未实现的阶段用 `skipped` 标记。
- 建立 `digital-human-agent/eval/rag/seed-docs/`、`rag-eval.seed.json` 和 `rag-eval.cases.json`。
- 新增 `npm run rag:seed-eval` 与 `npm run rag:eval`，先跑出当前向量检索 baseline。
- 增加 LangSmith 环境变量配置说明。
- 给 `AgentService`、`KnowledgeService`、`RerankerService` 关键调用加 trace metadata。
- 前端命中测试增加“检索过程”区域。

完成后再进入 P1 的 query rewrite。这样可以先看到当前检索链路的真实表现，再判断后面的 hybrid、ES、Agentic RAG 应该优先解决哪些问题。
