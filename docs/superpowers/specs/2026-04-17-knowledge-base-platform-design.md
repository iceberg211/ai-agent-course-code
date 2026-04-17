# digital-human-agent 企业级知识库演进设计

**日期**：2026-04-17
**作者**：wei.he
**范围**：`digital-human-agent/` + `digital-human-agent-frontend/`
**目标定位**：学习导向的"会说话的 MaxKB" —— 把现有"角色拥有文档"升级为"独立知识库资产 + 角色挂载"，保留语音/数字人差异化，不做多租户/RBAC/工作流/嵌入/审计。

---

## 1. 背景

### 1.1 现状盘点

**后端（NestJS，端口 3001）**

- `persona` 表：角色配置（name / description / speakingStyle / expertise / voiceId / avatarId）
- `knowledge_document` 表：文档元信息，外键 `persona_id` —— **文档属于 persona**
- `persona_knowledge` 表（Supabase 直连，无 TypeORM entity）：chunk + embedding，字段含 `persona_id / document_id / chunk_index / content / source / category / embedding`
- `match_knowledge` RPC：按 `p_persona_id` 过滤 + cosine 相似度
- `KnowledgeController`：`POST /knowledge/:personaId/documents`（上传，已支持 PDF/TXT/MD/CSV/JSON/LOG）/ `GET /documents` / `POST /search` / `DELETE /documents/:docId`
- `KnowledgeService.ingestDocument(personaId, filename, content)`：用 `RecursiveCharacterTextSplitter`（500/100）切分 → OpenAI embedding → Supabase 批量写入
- `retrieveWithStages`：已返回 stage1 / stage2 两阶段结果，前端可用
- `AgentService.run` 直接调 `knowledgeService.retrieve(personaId, query, {...})`

**前端（Vue 3 + Vite，端口 5173）**

- `App.vue` 三栏布局：`PersonaPanel | ChatMain | DocsDrawer`
- `DocsDrawer` 已内嵌"检索测试"面板，展示 stage1 / stage2 相似度与 rerank 分数
- `useKnowledge.ts` hook：`fetchDocuments / uploadDocument / deleteDocument / searchKnowledge`，接口全部基于 `personaId`
- 没有"知识库"这个一级概念；知识总是挂在当前选中角色下

### 1.2 目标形态

对标 MaxKB 的核心产品形态，**但只抓知识库核心**：

- 知识库（KnowledgeBase）是独立的一等资产，有自己的管理页面
- 一个 persona 可以挂载多个知识库（复用"产品 FAQ 库"、"公司政策库"等）
- 文档归属于知识库，不再直接挂 persona
- 每个知识库可以独立配置检索参数
- chunk 可在 UI 里查看、启用/禁用（禁用不删 embedding，SQL 过滤）
- 命中测试从"抽屉里的小面板"升级为知识库独立页面，是调试和"产品卖点"的主入口
- 保留现有 persona / 语音 / 数字人 / Agent 对话链路，只改检索入口

---

## 2. MVP 功能范围

### ✅ 纳入

1. `KnowledgeBase` 独立实体 + CRUD
2. `Persona ↔ KnowledgeBase` 多对多挂载
3. 保留已有多格式文档上传（PDF/TXT/MD 等）
4. `KnowledgeChunk` 引入 TypeORM entity，chunk 可视化
5. chunk 启用/禁用（`enabled: boolean` 列，检索 SQL 过滤）
6. 命中测试独立页面（展示 stage1/stage2、相似度、rerank 分数、命中 chunk 内容）
7. 每个知识库独立的检索参数（threshold / topK / rerank）

### ⏸ v2 候选

- Chunk 内容编辑（需重算 embedding）、手动新增 chunk、文档重新切分
- 分段策略可配置（chunk size / overlap / separators）
- URL 爬取 / FAQ 问答对直录
- 元数据 / 标签过滤
- 跨知识库分析统计

### ❌ 不做

- 多租户 / RBAC / 认证（学习项目）
- 工作流编排
- 嵌入 Widget / API Key 外部接入
- 审计日志 / 数据看板
- 多 LLM 供应商管理

---

## 3. 数据模型设计

### 3.1 新增与改造

```
knowledge_base                        (新增)
├── id               UUID PK
├── name             TEXT NOT NULL
├── description      TEXT
├── owner_persona_id UUID NULL REFERENCES persona(id) ON DELETE SET NULL
├── retrieval_config JSONB NOT NULL DEFAULT '{"threshold":0.6,"stage1TopK":20,"finalTopK":5,"rerank":true}'
├── created_at       TIMESTAMPTZ DEFAULT now()
└── updated_at       TIMESTAMPTZ DEFAULT now()

persona_knowledge_base                (新增，多对多)
├── persona_id         UUID REFERENCES persona(id) ON DELETE CASCADE
├── knowledge_base_id  UUID REFERENCES knowledge_base(id) ON DELETE CASCADE
├── created_at         TIMESTAMPTZ DEFAULT now()
└── PRIMARY KEY (persona_id, knowledge_base_id)

knowledge_document                    (改造)
├── persona_id        ← 删除
├── knowledge_base_id UUID NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE   (新增)
├── mime_type         TEXT          (新增)
├── file_size         INT           (新增)
├── source_type       TEXT NOT NULL DEFAULT 'upload'   (新增，为 v2 的 URL/FAQ 预留)
└── 其他字段不变

knowledge_chunk                       (改造：从 persona_knowledge 重命名并瘦身)
├── id           UUID PK
├── document_id  UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE
├── chunk_index  INT NOT NULL
├── content      TEXT NOT NULL
├── char_count   INT GENERATED ALWAYS AS (char_length(content)) STORED   (新增)
├── enabled      BOOLEAN NOT NULL DEFAULT true                            (新增)
├── embedding    VECTOR(1024)
├── source       TEXT NOT NULL
├── category     TEXT
└── created_at   TIMESTAMPTZ DEFAULT now()
# persona_id 列删除（通过 document → knowledge_base 反查）
```

**索引**：
- `knowledge_chunk (document_id)`
- `knowledge_chunk USING ivfflat (embedding vector_cosine_ops)`（向量索引，原本就应该有）
- `knowledge_document (knowledge_base_id)`
- `persona_knowledge_base (knowledge_base_id)`

### 3.2 `match_knowledge` RPC 重写

```sql
CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding  VECTOR(1024),
  p_kb_ids         UUID[],
  match_threshold  FLOAT,
  match_count      INT
)
RETURNS TABLE (
  id              UUID,
  content         TEXT,
  source          TEXT,
  chunk_index     INT,
  category        TEXT,
  similarity      FLOAT,
  knowledge_base_id UUID
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id, c.content, c.source, c.chunk_index, c.category,
    1 - (c.embedding <=> query_embedding) AS similarity,
    d.knowledge_base_id
  FROM knowledge_chunk c
  JOIN knowledge_document d ON d.id = c.document_id
  WHERE d.knowledge_base_id = ANY(p_kb_ids)
    AND c.enabled = true
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

**关键变化**：`p_persona_id UUID` → `p_kb_ids UUID[]`；加 `c.enabled = true` 过滤；返回 `knowledge_base_id` 便于前端展示"命中了哪个 KB"。

### 3.3 关键设计取舍

| 决定 | 理由 |
| --- | --- |
| `owner_persona_id` 允许为空 | 支持"公共知识库"；未来若去掉 persona 也有路径 |
| `retrieval_config` 放 KB 上 | FAQ 类库 threshold 高、长文档类库 topK 大，需分别调 |
| `enabled` 只做 SQL 过滤，不删 embedding | 禁用可逆；切换代价 O(1)，不需要重跑 ingest |
| `char_count` 作为 GENERATED 列 | chunk 列表展示字符数无需应用层计算 |
| chunk 表去掉 `persona_id` | 冗余；通过 document 反查即可，迁移到新所有权模型更干净 |

---

## 4. 后端改造点

### 4.1 新增模块 `src/knowledge-base/`

```
knowledge-base/
├── knowledge-base.entity.ts          # KnowledgeBase
├── knowledge-base.module.ts
├── knowledge-base.controller.ts
├── knowledge-base.service.ts
└── dto/
    ├── create-kb.dto.ts
    ├── update-kb.dto.ts
    └── attach-persona.dto.ts
```

**API 设计**

```
GET    /knowledge-bases                          列出所有 KB
POST   /knowledge-bases                          创建 KB  { name, description?, ownerPersonaId?, retrievalConfig? }
GET    /knowledge-bases/:kbId                    获取 KB 详情（含 document 数 / chunk 数）
PATCH  /knowledge-bases/:kbId                    更新 KB（含 retrievalConfig）
DELETE /knowledge-bases/:kbId                    删除 KB（级联 document + chunk）
GET    /knowledge-bases/:kbId/personas           列出挂载的 personas
POST   /personas/:personaId/knowledge-bases      挂载 KB 到 persona  { knowledgeBaseId }
DELETE /personas/:personaId/knowledge-bases/:kbId 解除挂载
```

### 4.2 改造 `src/knowledge/`

**`KnowledgeDocument` 实体**：`personaId` → `knowledgeBaseId`，补 `mimeType / fileSize / sourceType` 列。

**`KnowledgeChunk` 实体**（新增，替代对 Supabase 直写）：

```ts
@Entity('knowledge_chunk')
export class KnowledgeChunk {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'document_id' }) documentId: string;
  @Column({ name: 'chunk_index' }) chunkIndex: number;
  @Column() content: string;
  @Column({ name: 'char_count' }) charCount: number;
  @Column({ default: true }) enabled: boolean;
  @Column() source: string;
  @Column({ nullable: true }) category: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  // 注：embedding 列是 vector(1024)，TypeORM entity 不映射这个字段；
  // 写入仍走 Supabase client（ingest 时批量 insert），读取走 RPC。
  // entity 只用于 chunk 列表查询、启用/禁用等非向量操作。
}
```

**`KnowledgeController` 路由改造**：

```
GET    /knowledge-bases/:kbId/documents                         列文档
POST   /knowledge-bases/:kbId/documents                         上传文档（multipart）
DELETE /knowledge-bases/:kbId/documents/:docId                  删文档
GET    /knowledge-bases/:kbId/documents/:docId/chunks           列 chunks
PATCH  /knowledge-bases/:kbId/chunks/:chunkId                   { enabled: boolean }
POST   /knowledge-bases/:kbId/search                            命中测试（retrieveWithStages）
POST   /personas/:personaId/search                              persona 聚合检索（用于调试"这个角色会检索到什么"）
```

**`KnowledgeService` 方法签名迁移**：

```ts
// 旧
ingestDocument(personaId, filename, content, category?)
retrieve(personaId, query, options)
retrieveWithStages(personaId, query, options)

// 新
ingestDocument(kbId, filename, content, mimeType, fileSize)
retrieve(kbIds: string[], query, options)             // 支持多 KB 并查
retrieveWithStages(kbIds: string[], query, options)
retrieveForPersona(personaId, query)                  // 查 persona 挂载的所有 KB，用各自 retrievalConfig 并查 → 合并 rerank
```

**`retrieveForPersona` 合并策略**：
1. 查 `persona_knowledge_base` 得到 kbIds
2. 对每个 kb 用各自的 `retrievalConfig.threshold / stage1TopK` 走 stage1
3. 所有 stage1 结果合并，按 similarity 全局排序
4. 用全局的 rerank（或用 persona 级的默认 config）跑 stage2
5. 返回 finalTopK

（简单合并策略，学习项目足够；复杂场景可引入 RRF（Reciprocal Rank Fusion）作为 v2）

### 4.3 改造 `AgentService`

```ts
// 旧
const chunks = await this.knowledgeService.retrieve(personaId, userMessage, {...})

// 新
const chunks = await this.knowledgeService.retrieveForPersona(personaId, userMessage)
```

单点改动，其余 prompt 构造、流式响应、引用推送全部不变。

### 4.4 Supabase migration 新增

`003_knowledge_base.sql`（新增）：
- 建 `knowledge_base` / `persona_knowledge_base`
- 为每个已有 persona 创建一个 "{persona.name} 默认知识库"
- 给 persona 与对应 KB 建挂载关系

`004_migrate_documents.sql`（新增）：
- 把 `knowledge_document.persona_id` 映射为对应的 `knowledge_base_id`
- 新增 `mime_type / file_size / source_type` 列并回填（无法回填的设为 NULL）
- 删除 `knowledge_document.persona_id` 列

`005_knowledge_chunk.sql`（新增）：
- 从 `persona_knowledge` rename 为 `knowledge_chunk`
- 添加 `enabled BOOLEAN DEFAULT true` 与 `char_count GENERATED` 列
- 删除 `persona_id` 列
- 重建向量索引

`006_rpc_rewrite.sql`（新增）：
- 重写 `match_knowledge` 为 `p_kb_ids UUID[]` 签名

---

## 5. 前端改造点

### 5.1 路由引入

目前 `App.vue` 是"单屏三栏"结构，没有路由。为了容纳"知识库管理"+"对话"+"命中测试"三个工作区，需要引入 `vue-router`。

**路由结构**：

```
/              ── 重定向到 /chat
/chat          ── 现在的三栏对话界面（PersonaPanel + ChatMain + DocsDrawer[瘦身]）
/kb            ── 知识库列表页
/kb/:kbId      ── 知识库详情（文档列表 + 配置 + 命中测试 Tab）
```

### 5.2 新增页面与组件

```
src/
├── router/
│   └── index.ts                             # vue-router 配置
├── views/
│   ├── ChatView.vue                         # 原 App.vue 的三栏
│   └── kb/
│       ├── KnowledgeBaseListView.vue        # /kb
│       ├── KnowledgeBaseDetailView.vue      # /kb/:kbId  容器 + tabs
│       ├── tabs/
│       │   ├── DocumentsTab.vue             # 文档列表 + 上传
│       │   ├── ChunksTab.vue                # 选中文档后的 chunk 列表
│       │   ├── HitTestTab.vue               # 命中测试（从 DocsDrawer 搬出来并做大）
│       │   └── SettingsTab.vue              # retrievalConfig 编辑
├── components/
│   └── kb/
│       ├── KnowledgeBaseCard.vue            # 列表卡片
│       ├── KnowledgeBaseCreateModal.vue
│       ├── DocumentRow.vue
│       ├── ChunkItem.vue                    # 单个 chunk（含启用开关）
│       └── HitResultPanel.vue               # stage1 / stage2 可视化
├── stores/
│   └── knowledgeBase.ts                     # KB 列表 + 当前选中
└── hooks/
    └── useKnowledgeBase.ts                  # KB CRUD + 文档 + chunk + 搜索
```

### 5.3 改造现有组件

**App.vue** → 改为 `<router-view>` 容器 + 顶部导航 `[对话 | 知识库]`

**原 App.vue 三栏** → 搬到 `views/ChatView.vue`

**PersonaPanel**：persona 详情卡增加"已挂载知识库"区域 + "管理挂载"按钮（打开一个 Modal，勾选可挂载的 KB）

**DocsDrawer**：
- 删除"检索测试"面板（搬到 `/kb/:kbId` 的 HitTestTab）
- 改为"当前角色挂载的知识库 + 每个 KB 下的文档"只读视图
- 上传按钮跳转到 `/kb/:kbId` 的 DocumentsTab（避免在对话页重复实现上传 UI）

**useKnowledge.ts**：
- 保留但迁移接口：`/api/knowledge/:personaId/*` → `/api/knowledge-bases/:kbId/*`
- 新增 `useKnowledgeBase.ts` 接管 KB 列表 / 挂载关系

### 5.4 关键页面设计

**`/kb` 知识库列表**

```
┌── 顶部 ──────────────────────────────────────────┐
│ 知识库  [+ 新建]                                    │
├───────────────────────────────────────────────────┤
│ ┌─ KnowledgeBaseCard ─┐  ┌─ KnowledgeBaseCard ─┐  │
│ │ 📚 产品 FAQ         │  │ 📚 公司政策         │  │
│ │ 12 文档 · 487 chunks │  │ 3 文档 · 62 chunks  │  │
│ │ 挂载角色：客服、销售 │  │ 挂载角色：HR        │  │
│ └─────────────────────┘  └─────────────────────┘  │
└───────────────────────────────────────────────────┘
```

**`/kb/:kbId` 知识库详情（Tabs）**

```
Breadcrumb: 知识库 / 产品 FAQ
[文档 (12)] [命中测试] [配置]

文档 Tab:
  上传区 | 文档列表
    - filename · status · chunks · size · 点击进入 chunk 列表
  选中文档后展开 chunks：
    [ ] §1  "产品于 2024 年发布..."  [switch ✓启用] [512 字符]
    [ ] §2  "核心功能包括..."         [switch ✓启用] [480 字符]
    [ ] §3  "定价说明..."             [switch  禁用] [256 字符]

命中测试 Tab:
  Query 输入框 + 参数调节（threshold / stage1TopK / finalTopK / rerank）
  ┌── Stage 1: 向量召回 ──┐  ┌── Stage 2: Rerank ──┐
  │ 1. doc-a §3 sim=0.82 │  │ 1. doc-a §3 score=9.2│
  │ 2. doc-b §1 sim=0.78 │  │ 2. doc-c §5 score=8.1│
  │ ...                   │  │ ...                   │
  └───────────────────────┘  └───────────────────────┘
  点击任一结果 → 右侧展开 chunk 完整内容 + 来源

配置 Tab:
  基础信息：name / description / ownerPersona
  检索参数：threshold（滑块）、stage1TopK、finalTopK、rerank（switch）
  危险区：删除知识库
```

### 5.5 类型定义（TS）

```ts
export interface KnowledgeBase {
  id: string
  name: string
  description?: string
  ownerPersonaId?: string
  retrievalConfig: {
    threshold: number
    stage1TopK: number
    finalTopK: number
    rerank: boolean
  }
  documentCount?: number
  chunkCount?: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeChunk {
  id: string
  documentId: string
  chunkIndex: number
  content: string
  charCount: number
  enabled: boolean
  source: string
  category?: string
}
```

---

## 6. 迁移方案

学习项目不做平滑过渡，执行一次性 migration：

1. **新建表**：`knowledge_base` / `persona_knowledge_base`
2. **默认 KB**：为每个存量 persona 创建 `{persona.name} 默认知识库`，owner_persona_id = persona.id
3. **挂载关系**：persona ↔ 自己的默认 KB 建 1 条挂载
4. **文档迁移**：`knowledge_document` 加 `knowledge_base_id` 列，按 persona → 默认 KB 回填，然后删 `persona_id` 列
5. **Chunks 迁移**：`persona_knowledge` 表 rename → `knowledge_chunk`，加 `enabled` + `char_count`，删 `persona_id` 列
6. **RPC 重写**：`match_knowledge` 签名改为 kb_ids 数组
7. **应用侧**：`AgentService.run` 切到 `retrieveForPersona`，`KnowledgeController` 改新路由，旧路由直接下线

**不提供回滚** —— 学习项目，迁移前把数据库备份一次即可。

---

## 7. 分阶段迭代计划

按**风险隔离 + 可独立验证**的原则分 4 阶段。每阶段都能独立跑起来、看到效果。

### Phase 1 · 数据层地基（~1 天）

**目标**：把数据模型搭好，跑通迁移，不动任何用户可见功能。

**工作项**：
1. 写 `003 ~ 006` 4 个 migration 文件
2. 新增 `KnowledgeBase` / `KnowledgeChunk` TypeORM entities
3. 改造 `KnowledgeDocument` entity（字段切换）
4. 跑一次本地迁移，验证现有数据完整（document 数、chunk 数、embedding 可检索）
5. 手写 SQL 验证 `match_knowledge` 新 RPC 返回正确（用已有 persona 的 kb_id 测）

**注意**：Phase 1 结束时，数据库已经是新结构，但 `match_knowledge` RPC 暂时保留**两份**（旧签名 `p_persona_id` + 新签名 `p_kb_ids`），旧签名内部转发到新 chunk 表，让老代码能跑。Phase 2 结束时再删掉旧签名。

**验收**：跑迁移后，用老的 `/chat` 接口得到的引用和迁移前一致（数据完整、检索未中断）。

### Phase 2 · 后端 API + Agent 切换（~1.5 天）

**目标**：后端 API 切到新路由，Agent 检索走新 `retrieveForPersona`。

**工作项**：
1. 新增 `KnowledgeBaseModule` + controller + service（CRUD + 挂载）
2. `KnowledgeController` 路由改 `:kbId` 版本 + chunk 管理接口
3. `KnowledgeService` 方法签名迁移（支持 `kbIds: string[]` 并查）
4. `AgentService.run` 切到 `retrieveForPersona`
5. 为新 API 加 Swagger 注解
6. 老路由 `/knowledge/:personaId/*` 下线或加 410 Gone

**验收**：
- Swagger 能操作 KB CRUD、挂载、chunk 启用禁用、命中测试
- 现有对话链路（文本 + 语音）引用来源仍然正确
- 禁用某个 chunk 后，重跑同一 query，该 chunk 不出现在结果里

### Phase 3 · 前端知识库工作区（~2 天）

**目标**：独立的 `/kb` 工作区上线，知识库完整自管。

**工作项**：
1. 引入 `vue-router`，`App.vue` 改为导航 shell + `<router-view>`
2. 原三栏布局搬到 `views/ChatView.vue`
3. 新建 `stores/knowledgeBase.ts` 和 `hooks/useKnowledgeBase.ts`
4. 实现 `KnowledgeBaseListView`（列表 + 新建）
5. 实现 `KnowledgeBaseDetailView` 容器 + 三个 tab（Documents / HitTest / Settings）
6. `DocumentsTab` 实现文档列表 + chunk 展开 + 启用/禁用开关
7. `HitTestTab` 把 DocsDrawer 里的检索面板做大（加 query 高亮、展开全文、参数调节）
8. `SettingsTab` 实现 retrievalConfig 编辑

**验收**：
- 能新建 KB、上传文档、查看 chunk、启用禁用
- 命中测试能看到 stage1/stage2，点击结果展开完整内容
- 调整 retrievalConfig 后命中测试结果随之变化

### Phase 4 · 对话页联动 + 收尾（~1 天）

**目标**：对话页适配新模型，整体串起来。

**工作项**：
1. `PersonaPanel` 增加"挂载知识库"Modal（多选 checkbox）
2. `DocsDrawer` 瘦身：显示 persona 挂载的 KB 列表 + 每个 KB 下的文档数；上传按钮跳 `/kb/:kbId`
3. 移除 `DocsDrawer` 里的检索测试面板（已迁移到 HitTestTab）
4. `ChatView` 消息引用展示"来自 KB xxx"（如果有多个 KB）
5. 删除未使用的旧代码（`useKnowledge.ts` 中 persona 相关路径、旧 types）
6. README 更新

**验收**：
- 对话能正常走，引用气泡带上 KB 信息
- 一个 persona 挂载两个 KB，对话检索能从两个 KB 合并结果
- 解除挂载后，对话不再检索该 KB

### 合计工期估算

约 **5.5 工作日**。每阶段独立可 demo，如果遇到阻塞可以单独停下排查不影响前一阶段成果。

---

## 8. 风险与权衡

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 迁移失败 / 数据丢失 | 一次性 migration 没有回滚 | 跑之前完整 `pg_dump` 备份；分步脚本在本地先演练一遍 |
| `retrieveForPersona` 多 KB 合并质量 | 简单 similarity 合并可能不如单 KB 内排序准 | v1 用全局 similarity 排序足够；如果效果差，v2 换 RRF |
| Supabase 向量索引重建成本 | chunks 表改名 + 列变更需重建 ivfflat 索引 | 学习项目数据量小，一次性重建几秒钟搞定 |
| 前端引入 router 改动大 | 路由化相当于 App 结构重构 | Phase 3 单独一段时间做，隔离在 ChatView 内，原逻辑整体复制即可 |
| Chunk enabled 字段加了但 UI 不易发现 | 用户上传完文档不知道可以禁用某段 | DocumentsTab 默认展开每个文档的 chunk 列表，禁用开关视觉上突出 |

---

## 9. 与 MaxKB 的差距（刻意不做的部分）

| MaxKB 功能 | 本次是否做 | 原因 |
| --- | --- | --- |
| 多租户 / 组织 / RBAC | ❌ | 学习项目单用户 |
| 应用（Application）抽象 | ❌ | persona 已扮演类似角色 |
| 工作流可视化编排 | ❌ | Agent 是固定 RAG pipeline，够用 |
| Web Widget 嵌入 / API Key | ❌ | 无外部接入需求 |
| 审计日志 / 数据看板 | ❌ | 无合规需求 |
| 多 LLM 供应商管理 | ❌ | `OPENAI_BASE_URL` 已能接阿里兼容，够用 |
| Chunk 手动编辑 / 新增 | ⏸ v2 | 需重算 embedding，边界场景多 |
| URL 爬取 / FAQ 直录 | ⏸ v2 | 价值大，工作量也大 |

**本次反而做了 MaxKB 没有的**：语音 ASR/TTS、数字人、语音克隆 —— 这是产品差异化。

---

## 10. 下一步

Spec 确认后，运行 `superpowers:writing-plans` 技能，把 Phase 1~4 拆成可执行的实现计划。
