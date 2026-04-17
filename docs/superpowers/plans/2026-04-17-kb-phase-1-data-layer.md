# KB Phase 1 · 数据层地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把数据库 schema 升级到"知识库作为独立资产"的新模型，并让现有 `/chat` 对话接口零回归地继续工作（通过 `match_knowledge_legacy` shim）。

**Architecture:** 4 个顺序执行的 SQL migration → 更新 `scripts/migrate.js` 的文件列表 → 新增/改造 3 个 TypeORM entity → 把 `KnowledgeService.retrieveStage1` 暂时切到 legacy shim。**本阶段不引入新的 HTTP 路由、不改前端、不引入 `KnowledgeBaseModule`**。

**Tech Stack:** PostgreSQL 15 + pgvector (Supabase) / NestJS 11 + TypeORM 0.3 / Node 22 / 迁移通过 `node scripts/migrate.js`（依赖 `DIRECT_URL` 环境变量，用 `pg` 直连）

**Spec:** `docs/superpowers/specs/2026-04-17-knowledge-base-platform-design.md`（Phase 1 部分）

---

## 前置准备（Task 0）

### Task 0: 数据库备份 + 创建目标分支

**Files:** 无

- [ ] **Step 1: 备份当前 Supabase 数据库**

在 `digital-human-agent/` 目录运行：

```bash
# 用 DIRECT_URL 中的连接串做 pg_dump
source .env
pg_dump "$DIRECT_URL" --no-owner --no-privileges > ~/backups/dha-before-kb-phase1-$(date +%Y%m%d-%H%M%S).sql
ls -lh ~/backups/dha-before-kb-phase1-*.sql
```

Expected: 看到一个体积 > 0 的 .sql 文件。

- [ ] **Step 2: 记录当前数据行数（用于后续 Migration 验证）**

```bash
psql "$DIRECT_URL" -c "
SELECT 'persona' AS table_name, count(*) FROM persona
UNION ALL SELECT 'knowledge_document', count(*) FROM knowledge_document
UNION ALL SELECT 'persona_knowledge', count(*) FROM persona_knowledge;
"
```

把输出记到便签，后面 Migration 验证要用。

- [ ] **Step 3: 确认当前分支**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git branch --show-current
git status
```

Expected: 在 `agent-rewrite` 分支，工作树干净。

---

## Task 1: Migration 003 — 创建知识库与挂载关系表

**Files:**
- Create: `digital-human-agent/supabase/migrations/003_knowledge_base.sql`

- [ ] **Step 1: 创建迁移文件**

```sql
-- 003_knowledge_base.sql
-- 目的：引入 knowledge_base 独立资产 + persona ↔ KB 多对多挂载表
-- 并为每个存量 persona 生成一个"默认知识库"占位

-- 1. knowledge_base 表
CREATE TABLE IF NOT EXISTS knowledge_base (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  description       TEXT,
  owner_persona_id  UUID REFERENCES persona(id) ON DELETE SET NULL,
  retrieval_config  JSONB NOT NULL DEFAULT '{"threshold":0.6,"stage1TopK":20,"finalTopK":5,"rerank":true}'::JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_base_owner_persona_id_idx
  ON knowledge_base (owner_persona_id);

-- 2. persona ↔ knowledge_base 多对多表
CREATE TABLE IF NOT EXISTS persona_knowledge_base (
  persona_id         UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  knowledge_base_id  UUID NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (persona_id, knowledge_base_id)
);

CREATE INDEX IF NOT EXISTS persona_knowledge_base_kb_id_idx
  ON persona_knowledge_base (knowledge_base_id);

-- 3. 为每个存量 persona 创建默认 KB（幂等：只有当该 persona 还没有 owner KB 时才创建）
INSERT INTO knowledge_base (name, description, owner_persona_id)
SELECT
  p.name || ' 默认知识库',
  '从旧数据结构迁移：' || p.name,
  p.id
FROM persona p
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base kb WHERE kb.owner_persona_id = p.id
);

-- 4. 建立 persona ↔ 自己默认 KB 的挂载关系（幂等）
INSERT INTO persona_knowledge_base (persona_id, knowledge_base_id)
SELECT kb.owner_persona_id, kb.id
FROM knowledge_base kb
WHERE kb.owner_persona_id IS NOT NULL
ON CONFLICT (persona_id, knowledge_base_id) DO NOTHING;
```

- [ ] **Step 2: 暂不执行，等全部 migration 写完一起执行（Task 5 统一运行）**

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/supabase/migrations/003_knowledge_base.sql
git commit -m "feat(kb): add migration 003 for knowledge_base + persona mapping

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migration 004 — 改造 knowledge_document 表

**Files:**
- Create: `digital-human-agent/supabase/migrations/004_migrate_documents.sql`

- [ ] **Step 1: 创建迁移文件**

```sql
-- 004_migrate_documents.sql
-- 目的：knowledge_document 改为以 KB 为父资产（删 persona_id，加 knowledge_base_id）
-- 保留：filename / status / chunk_count / created_at
-- 新增：mime_type / file_size / source_type

-- 1. 添加新列
ALTER TABLE knowledge_document
  ADD COLUMN IF NOT EXISTS knowledge_base_id UUID REFERENCES knowledge_base(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS mime_type   TEXT,
  ADD COLUMN IF NOT EXISTS file_size   INT,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'upload';

-- 2. 回填 knowledge_base_id：用 persona → 该 persona 的默认 KB 的映射
-- 每个 persona 在 003 中已经有对应的 owner KB
UPDATE knowledge_document d
SET knowledge_base_id = kb.id
FROM knowledge_base kb
WHERE kb.owner_persona_id = d.persona_id
  AND d.knowledge_base_id IS NULL;

-- 3. 回填完成后，把 knowledge_base_id 设为 NOT NULL
ALTER TABLE knowledge_document
  ALTER COLUMN knowledge_base_id SET NOT NULL;

-- 4. 创建 knowledge_base_id 索引
CREATE INDEX IF NOT EXISTS knowledge_document_kb_id_idx
  ON knowledge_document (knowledge_base_id);

-- 5. 删除 persona_id 列（此时已没用，知识库通过 KB 挂载定位 persona）
ALTER TABLE knowledge_document DROP COLUMN IF EXISTS persona_id;
```

- [ ] **Step 2: Commit**

```bash
git add digital-human-agent/supabase/migrations/004_migrate_documents.sql
git commit -m "feat(kb): add migration 004 for knowledge_document restructure

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Migration 005 — 改造 persona_knowledge → knowledge_chunk

**Files:**
- Create: `digital-human-agent/supabase/migrations/005_knowledge_chunk.sql`

- [ ] **Step 1: 创建迁移文件**

```sql
-- 005_knowledge_chunk.sql
-- 目的：
-- 1) 把 persona_knowledge rename 为 knowledge_chunk（名字更直觉）
-- 2) 加 enabled（驱动启用/禁用）、char_count（GENERATED 列）
-- 3) 删除 persona_id（通过 document → kb 反查即可）
-- 4) 索引重建：向量索引、document_id 索引

-- 1. 重命名
ALTER TABLE IF EXISTS persona_knowledge RENAME TO knowledge_chunk;

-- 2. 加 enabled 列
ALTER TABLE knowledge_chunk
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

-- 3. 加 char_count GENERATED 列
-- 注意：GENERATED 列写入操作会被 PG 拒绝（insert 必须用 DEFAULT），entity 层需要 insert:false,update:false
ALTER TABLE knowledge_chunk
  ADD COLUMN IF NOT EXISTS char_count INT
    GENERATED ALWAYS AS (char_length(content)) STORED;

-- 4. 删除 persona_id（旧结构冗余列）
ALTER TABLE knowledge_chunk DROP COLUMN IF EXISTS persona_id;

-- 5. 重建索引
-- 旧表上的 (persona_id) 索引已随列删除自动失效，不需显式 DROP
CREATE INDEX IF NOT EXISTS knowledge_chunk_document_id_idx
  ON knowledge_chunk (document_id);

-- 向量索引：如果之前有 ivfflat 索引名未知，通过 pg_indexes 查一下，无需则显式建。
-- 这里为幂等方便，直接按期望的索引名建一个（已有则跳过）：
-- 需要在有数据的前提下建 ivfflat，否则 PG 会提示 lists=100 过大
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'knowledge_chunk'
      AND indexname = 'knowledge_chunk_embedding_idx'
  ) THEN
    EXECUTE 'CREATE INDEX knowledge_chunk_embedding_idx ON knowledge_chunk '
         || 'USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
  END IF;
END
$$;
```

- [ ] **Step 2: Commit**

```bash
git add digital-human-agent/supabase/migrations/005_knowledge_chunk.sql
git commit -m "feat(kb): add migration 005 renaming persona_knowledge to knowledge_chunk

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Migration 006 — RPC 重写 + legacy shim

**Files:**
- Create: `digital-human-agent/supabase/migrations/006_rpc_rewrite.sql`

- [ ] **Step 1: 创建迁移文件**

```sql
-- 006_rpc_rewrite.sql
-- 目的：
-- 1) 丢弃旧 match_knowledge（因为它引用了已经不存在的 persona_knowledge.persona_id，
--    以及返回行形状即将变化，不能 CREATE OR REPLACE）
-- 2) 定义新 match_knowledge(p_kb_id UUID, ...)
-- 3) 定义过渡 shim match_knowledge_legacy(p_persona_id UUID, ...)
--    内部 JOIN persona_knowledge_base 把 persona_id 翻译成 kb_ids
--    Phase 2 Agent/Service 切换完成后删除此 shim

-- 1. 丢弃旧函数
DROP FUNCTION IF EXISTS match_knowledge(VECTOR, UUID, FLOAT, INT);

-- 2. 新的单 KB 签名
CREATE FUNCTION match_knowledge(
  query_embedding  VECTOR(1024),
  p_kb_id          UUID,
  match_threshold  FLOAT,
  match_count      INT
)
RETURNS TABLE (
  id                UUID,
  content           TEXT,
  source            TEXT,
  chunk_index       INT,
  category          TEXT,
  similarity        FLOAT,
  knowledge_base_id UUID
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.content,
    c.source,
    c.chunk_index,
    c.category,
    1 - (c.embedding <=> query_embedding) AS similarity,
    d.knowledge_base_id
  FROM knowledge_chunk c
  JOIN knowledge_document d ON d.id = c.document_id
  WHERE d.knowledge_base_id = p_kb_id
    AND c.enabled = true
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 3. 过渡 shim：保 Phase 1 末老代码还能跑
-- Phase 2 切换完成后用 DROP FUNCTION match_knowledge_legacy(...) 清掉
CREATE FUNCTION match_knowledge_legacy(
  query_embedding  VECTOR(1024),
  p_persona_id     UUID,
  match_threshold  FLOAT,
  match_count      INT
)
RETURNS TABLE (
  id          UUID,
  content     TEXT,
  source      TEXT,
  chunk_index INT,
  category    TEXT,
  similarity  FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.content,
    c.source,
    c.chunk_index,
    c.category,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunk c
  JOIN knowledge_document d ON d.id = c.document_id
  JOIN persona_knowledge_base pkb ON pkb.knowledge_base_id = d.knowledge_base_id
  WHERE pkb.persona_id = p_persona_id
    AND c.enabled = true
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add digital-human-agent/supabase/migrations/006_rpc_rewrite.sql
git commit -m "feat(kb): add migration 006 rewriting match_knowledge RPC + legacy shim

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 更新 migrate.js 并执行全部迁移

**Files:**
- Modify: `digital-human-agent/scripts/migrate.js:17`

- [ ] **Step 1: 把 003~006 加入 MIGRATIONS 列表**

打开 `digital-human-agent/scripts/migrate.js`，把第 17 行：

```js
const MIGRATIONS = ['001_init.sql', '002_rpc.sql'];
```

改为：

```js
const MIGRATIONS = [
  '001_init.sql',
  '002_rpc.sql',
  '003_knowledge_base.sql',
  '004_migrate_documents.sql',
  '005_knowledge_chunk.sql',
  '006_rpc_rewrite.sql',
];
```

- [ ] **Step 2: 跑迁移**

**重要**：迁移过程中 005→006 之间存在短暂的 RPC 不一致状态（005 把 `persona_knowledge` 改名后，旧 `match_knowledge` 函数体就失效了；006 才重建）。因此**必须先停掉 dev server 再跑迁移**。

```bash
# 确保没有 dev server 在跑：
lsof -iTCP:3001 -sTCP:LISTEN -n -P
# 若有输出，去终端 Ctrl+C 关闭

cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npm run db:migrate
```

Expected output: 看到 `✅ 003_knowledge_base.sql done` / `✅ 004_migrate_documents.sql done` / `✅ 005_knowledge_chunk.sql done` / `✅ 006_rpc_rewrite.sql done`，最后 `🎉 All migrations completed successfully`。

- [ ] **Step 3: 数据完整性验证**

运行下面的 SQL 对比 Task 0 Step 2 记录的数字：

```bash
psql "$DIRECT_URL" <<'SQL'
-- 核心表行数
SELECT 'persona' AS t, count(*) FROM persona
UNION ALL SELECT 'knowledge_base', count(*) FROM knowledge_base
UNION ALL SELECT 'persona_knowledge_base', count(*) FROM persona_knowledge_base
UNION ALL SELECT 'knowledge_document', count(*) FROM knowledge_document
UNION ALL SELECT 'knowledge_chunk', count(*) FROM knowledge_chunk;

-- 不应该有 NULL knowledge_base_id
SELECT count(*) AS bad_docs FROM knowledge_document WHERE knowledge_base_id IS NULL;

-- persona_knowledge 表应该已经不存在
SELECT to_regclass('persona_knowledge') AS should_be_null;

-- 新旧两个 RPC 都应该存在
SELECT proname FROM pg_proc
WHERE proname IN ('match_knowledge', 'match_knowledge_legacy')
ORDER BY proname;
SQL
```

Expected:
- `knowledge_base` 行数 = persona 行数（每个 persona 有默认 KB）
- `persona_knowledge_base` 行数 = persona 行数（每个 persona 挂了 1 个默认 KB）
- `knowledge_document` 行数 = Task 0 Step 2 里的旧值
- `knowledge_chunk` 行数 = Task 0 Step 2 里 `persona_knowledge` 的旧值
- `bad_docs` = 0
- `should_be_null` = null（旧表已消失）
- 两个 `match_knowledge*` 函数都列出

- [ ] **Step 4: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/scripts/migrate.js
git commit -m "feat(kb): register migrations 003-006 in migrate.js

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 创建 KnowledgeBase entity

**Files:**
- Create: `digital-human-agent/src/knowledge-base/knowledge-base.entity.ts`

- [ ] **Step 1: 新建目录并写 entity**

```bash
mkdir -p /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent/src/knowledge-base
```

创建 `digital-human-agent/src/knowledge-base/knowledge-base.entity.ts`：

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface KnowledgeBaseRetrievalConfig {
  threshold: number;
  stage1TopK: number;
  finalTopK: number;
  rerank: boolean;
}

@Entity('knowledge_base')
export class KnowledgeBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'owner_persona_id', type: 'uuid', nullable: true })
  ownerPersonaId: string | null;

  @Column({ name: 'retrieval_config', type: 'jsonb' })
  retrievalConfig: KnowledgeBaseRetrievalConfig;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

- [ ] **Step 2: 编译通过性验证**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npx tsc --noEmit
```

Expected: 没有错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/src/knowledge-base/knowledge-base.entity.ts
git commit -m "feat(kb): add KnowledgeBase TypeORM entity

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 创建 KnowledgeChunk entity

**Files:**
- Create: `digital-human-agent/src/knowledge/knowledge-chunk.entity.ts`

- [ ] **Step 1: 新建 entity**

创建 `digital-human-agent/src/knowledge/knowledge-chunk.entity.ts`：

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { KnowledgeDocument } from './knowledge-document.entity';

@Entity('knowledge_chunk')
export class KnowledgeChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @ManyToOne(() => KnowledgeDocument, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: KnowledgeDocument;

  @Column({ name: 'chunk_index' })
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;

  // char_count 是 PG GENERATED ALWAYS 列，TypeORM 必须显式标记只读
  // 否则 INSERT/UPDATE 时会传入值，PG 会返回：
  //   "column \"char_count\" can only be updated to DEFAULT"
  @Column({ name: 'char_count', insert: false, update: false })
  charCount: number;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'text' })
  source: string;

  @Column({ type: 'text', nullable: true })
  category: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // 注：embedding 列是 VECTOR(1024)，TypeORM entity 故意不映射该字段。
  // 写入 embedding 走 Supabase client（ingest 时批量 insert），
  // 读取走 match_knowledge RPC。entity 只用于 chunk 列表查询、
  // 启用/禁用开关等非向量操作。
}
```

- [ ] **Step 2: 编译通过性验证**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npx tsc --noEmit
```

Expected: 没有错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/src/knowledge/knowledge-chunk.entity.ts
git commit -m "feat(kb): add KnowledgeChunk TypeORM entity

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 改造 KnowledgeDocument entity

**Files:**
- Modify: `digital-human-agent/src/knowledge/knowledge-document.entity.ts`

- [ ] **Step 1: 用新内容替换整个 entity 文件**

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { KnowledgeBase } from '../knowledge-base/knowledge-base.entity';

export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type DocumentSourceType = 'upload';

@Entity('knowledge_document')
export class KnowledgeDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @ManyToOne(() => KnowledgeBase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'knowledge_base_id' })
  knowledgeBase: KnowledgeBase;

  @Column()
  filename: string;

  @Column({ default: 'pending' })
  status: DocumentStatus;

  @Column({ name: 'chunk_count', default: 0 })
  chunkCount: number;

  @Column({ name: 'mime_type', type: 'text', nullable: true })
  mimeType: string | null;

  @Column({ name: 'file_size', type: 'int', nullable: true })
  fileSize: number | null;

  @Column({ name: 'source_type', type: 'text', default: 'upload' })
  sourceType: DocumentSourceType;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: 编译通过性验证**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npx tsc --noEmit
```

Expected output: 这一步预期会出现编译错误，指向：
- `src/knowledge/knowledge.service.ts`：`ingestDocument(personaId, ...)` 里引用了 `this.docRepo.create({ personaId, ... })`、`find({ where: { personaId } })`
- `src/knowledge/knowledge.controller.ts`：`:personaId` 参数 + 传入 service
- 这些错误会在 Task 9 修完

**先不要 commit**，进入 Task 9 把关联改动做完一起提交。

---

## Task 9: KnowledgeService 切到 legacy RPC + 适配 entity 变化

**Files:**
- Modify: `digital-human-agent/src/knowledge/knowledge.service.ts`

> 本阶段**不拆** controller 路由。Phase 1 的约束是"接口不变，数据模型变"。`:personaId` 路由继续存在，内部 service 通过"persona → 默认 KB"映射完成旧行为。Phase 2 再整体切 URL。

- [ ] **Step 1: 读当前文件，定位需要改的段**

```bash
cat /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent/src/knowledge/knowledge.service.ts | head -60
```

主要改动点：
- `ingestDocument(personaId, filename, content, category?)` → 内部把 personaId 翻译成 persona 的默认 KB id，再 insert knowledge_document（`knowledge_base_id` 列）
- `listDocuments(personaId)` → 改成按"挂载到该 persona 的所有 KB 下的文档"查
- `retrieveStage1` → 从 `match_knowledge` 切换到 `match_knowledge_legacy`（行为语义不变）
- Chunk insert 目标表从 `persona_knowledge` 改成 `knowledge_chunk`，不写 `persona_id` 列

- [ ] **Step 2: 改 `ingestDocument`**

在 `src/knowledge/knowledge.service.ts` 中找到 `ingestDocument` 方法。改动三处：

**(a) 方法开头，在 `this.docRepo.save(...)` 之前**：

```ts
// 取 persona 默认 KB：owner_persona_id = personaId 的 KB
// Phase 1 只有 1 对 1 映射（003 migration 保证每个 persona 有 owner KB）
const { data: kbRow, error: kbErr } = await this.supabase
  .from('knowledge_base')
  .select('id')
  .eq('owner_persona_id', personaId)
  .limit(1)
  .single();
if (kbErr || !kbRow?.id) {
  throw new Error(
    `未找到 persona ${personaId} 的默认知识库，请确认 003 migration 已执行`,
  );
}
const knowledgeBaseId = kbRow.id as string;
```

**(b) `this.docRepo.save(this.docRepo.create({ personaId, filename, status: 'processing' }))` 改为**：

```ts
const doc = await this.docRepo.save(
  this.docRepo.create({
    knowledgeBaseId,
    filename,
    status: 'processing',
  }),
);
```

**(c) 往 Supabase 写 chunks 时，写到 `knowledge_chunk` 表，不写 `persona_id`**：

找到：

```ts
const rows = chunks.map((chunk, i) => ({
  persona_id: personaId,
  document_id: doc.id,
  chunk_index: i,
  content: chunk.pageContent,
  source: filename,
  category: category ?? null,
  embedding: JSON.stringify(embeddings[i]),
}));
```

改为：

```ts
const rows = chunks.map((chunk, i) => ({
  document_id: doc.id,
  chunk_index: i,
  content: chunk.pageContent,
  source: filename,
  category: category ?? null,
  embedding: JSON.stringify(embeddings[i]),
}));
```

并把下面的：

```ts
const r = await this.supabase
  .from('persona_knowledge')
  .insert(batch);
```

改为：

```ts
const r = await this.supabase
  .from('knowledge_chunk')
  .insert(batch);
```

- [ ] **Step 3: 改 `listDocuments`**

```ts
listDocuments(personaId: string): Promise<KnowledgeDocument[]> {
  return this.docRepo
    .createQueryBuilder('doc')
    .innerJoin('persona_knowledge_base', 'pkb', 'pkb.knowledge_base_id = doc.knowledge_base_id')
    .where('pkb.persona_id = :personaId', { personaId })
    .orderBy('doc.created_at', 'DESC')
    .getMany();
}
```

- [ ] **Step 4: 改 `retrieveStage1` 切到 legacy RPC**

找到 `retrieveStage1` 方法里的：

```ts
const result = await this.supabase.rpc('match_knowledge', {
  query_embedding: queryEmbedding,
  p_persona_id: personaId,
  match_threshold: threshold,
  match_count: matchCount,
});
```

改为：

```ts
// Phase 1 过渡期：Agent 仍按 personaId 检索，走 shim RPC 在 SQL 内部翻译为 kb_ids
// Phase 2 切换到 retrieveForPersona + match_knowledge（单 KB 版） 后，删除此调用
const result = await this.supabase.rpc('match_knowledge_legacy', {
  query_embedding: queryEmbedding,
  p_persona_id: personaId,
  match_threshold: threshold,
  match_count: matchCount,
});
```

（只改 RPC 名，其他参数名完全相同；legacy shim 和旧 RPC 的返回行 schema 一致。）

- [ ] **Step 5: `deleteDocument` 保持不变**

原逻辑 `docRepo.delete(documentId)` 依赖 FK ON DELETE CASCADE，005 migration 保留了 `knowledge_chunk.document_id ON DELETE CASCADE` 外键约束，所以仍然有效。无需改动。

- [ ] **Step 6: 编译通过性验证**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npx tsc --noEmit
```

Expected: 没有错误。

- [ ] **Step 7: Commit（把 Task 8 + Task 9 的变更一起提交）**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/src/knowledge/knowledge-document.entity.ts \
        digital-human-agent/src/knowledge/knowledge.service.ts
git commit -m "feat(kb): migrate knowledge_document entity to kb_id + route service to legacy shim

- KnowledgeDocument: persona_id -> knowledge_base_id, add mime_type/file_size/source_type
- ingestDocument: resolve persona -> owner KB, insert into knowledge_chunk
- listDocuments: join persona_knowledge_base to find docs via mounted KBs
- retrieveStage1: call match_knowledge_legacy to preserve phase-1 behavior

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 冒烟测试 — /chat 文本接口 + 知识库抽屉

**Files:** 无（仅运行 + 观察）

- [ ] **Step 1: 启动后端**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npm run start:dev
```

Expected: 看到 NestJS 正常启动，端口 3001，无 startup 错误。

- [ ] **Step 2: 找一个有知识的 persona id**

新开终端：

```bash
psql "$DIRECT_URL" -c "
SELECT p.id, p.name, count(c.id) AS chunks
FROM persona p
LEFT JOIN persona_knowledge_base pkb ON pkb.persona_id = p.id
LEFT JOIN knowledge_document d ON d.knowledge_base_id = pkb.knowledge_base_id
LEFT JOIN knowledge_chunk c ON c.document_id = d.id
GROUP BY p.id, p.name
ORDER BY chunks DESC
LIMIT 3;
"
```

挑一个 `chunks > 0` 的 persona id，记为 `<PID>`。

- [ ] **Step 3: 创建 conversation**

> 注：该项目 conversation controller 的实际路径可能是 `/conversations` 或 `/conversation`，若 curl 404，看一眼 `src/conversation/conversation.controller.ts` 里的 `@Controller(...)` 值。

```bash
curl -s -X POST http://localhost:3001/conversations \
  -H 'content-type: application/json' \
  -d "{\"personaId\":\"<PID>\"}" | jq .
```

Expected: 返回 `{ id: "...", personaId: "<PID>", ... }`，记 `id` 为 `<CID>`。

- [ ] **Step 4: 用旧的检索调试接口（依赖 `match_knowledge_legacy`）验证命中**

```bash
curl -s -X POST http://localhost:3001/knowledge/<PID>/search \
  -H 'content-type: application/json' \
  -d '{"query":"<一个你知道文档里有的关键词>","rerank":false,"finalTopK":3}' | jq .
```

Expected:
- `stage1` 数组非空
- 命中的 `source` 字段能对上上传的文档名
- 无 5xx 报错

如果 `stage1` 是空的，检查：
- legacy RPC 是否正确（`psql` 里手工调一下 `match_knowledge_legacy(...)`）
- `knowledge_chunk.enabled` 是否都是 `true`
- `persona_knowledge_base` 里这个 persona 的挂载关系是否存在

- [ ] **Step 5: 跑对话确认 Agent 也在用 legacy RPC**

```bash
curl -N -X POST http://localhost:3001/chat \
  -H 'content-type: application/json' \
  -d "{
    \"conversationId\":\"<CID>\",
    \"personaId\":\"<PID>\",
    \"message\":\"<一个相关问题>\"
  }"
```

Expected: 看到流式返回的 token（AI SDK 协议），回答里引用了知识库内容。查看后端日志，应该能看到类似 `[Embedding 完成]` / 检索调试信息，没有报错。

- [ ] **Step 6: 前端 smoke（可选）**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent-frontend
npm run dev
```

打开 http://localhost:5173，选中那个 persona，按住麦克风说话（或直接打字），确认：
- 消息能正常流回
- 消息底部的 citation chips 能正常出现
- 知识库抽屉里文档列表正常

- [ ] **Step 7: 验证新表未被前端写入（数据完整性）**

```bash
psql "$DIRECT_URL" -c "
SELECT 'kb' AS t, count(*) FROM knowledge_base
UNION ALL SELECT 'pkb', count(*) FROM persona_knowledge_base
UNION ALL SELECT 'doc_null_kb', count(*) FROM knowledge_document WHERE knowledge_base_id IS NULL
UNION ALL SELECT 'chunk_disabled', count(*) FROM knowledge_chunk WHERE enabled = false;
"
```

Expected:
- `kb` = persona 行数（若新建 persona 测试了没挂默认 KB，可能会差 1，可忽略）
- `pkb` = kb（或 > kb，如果多次 ingest）
- `doc_null_kb` = 0
- `chunk_disabled` = 0（Phase 1 还没暴露启用开关，全是 true）

- [ ] **Step 8: 全部通过则 tag 一下 phase-1 完成点**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git log --oneline -10
git tag kb-phase1-done
```

---

## 验收清单（Phase 1 完成条件）

所有 Task 0~10 全部打勾，且：

- [ ] `digital-human-agent/supabase/migrations/` 下新增 4 个 SQL 文件（003~006），都已 commit
- [ ] `scripts/migrate.js` 的 `MIGRATIONS` 数组包含新文件，`npm run db:migrate` 成功执行
- [ ] 数据库中：
  - `knowledge_base`、`persona_knowledge_base`、`knowledge_chunk` 表存在
  - `persona_knowledge` 旧表已不存在
  - `knowledge_document.persona_id` 列已删除，`knowledge_base_id` 列非空
  - `match_knowledge(vector, uuid, float, int)` 和 `match_knowledge_legacy(vector, uuid, float, int)` 两个函数都存在
- [ ] TypeScript 编译通过（`npx tsc --noEmit`）
- [ ] `/knowledge/:personaId/search` 调试接口能返回命中的 chunks
- [ ] `/chat` 文本流对话正常工作，引用来源可见
- [ ] 前端知识库抽屉的文档列表正常、检索测试面板正常

---

## Phase 1 故意**不做**的事（避免 scope creep）

- 不新增 `KnowledgeBaseController` / `KnowledgeBaseService`（Phase 2 再加）
- 不改任何 HTTP 路由路径（`/knowledge/:personaId/*` 全部保留）
- 不改 `AgentService`（依旧调 `knowledgeService.retrieve(personaId, ...)`）
- 不改前端任何代码
- 不引入 `vue-router`

如果发现改到了这些文件，马上 revert。

---

## 下一阶段

Phase 1 完成并打了 `kb-phase1-done` tag 后，运行 `superpowers:writing-plans` 生成：

`docs/superpowers/plans/2026-04-17-kb-phase-2-backend-api.md`

Phase 2 的目标：新 `KnowledgeBaseModule`、`/knowledge-bases/*` 路由、`retrieveForPersona` 多 KB 并发合并、`AgentService` 切过去、删除 `match_knowledge_legacy` shim。
