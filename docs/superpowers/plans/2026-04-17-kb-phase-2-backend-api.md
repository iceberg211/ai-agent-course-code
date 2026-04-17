# KB Phase 2 · 后端 API + Agent 切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 暴露 `/knowledge-bases/*` 的 REST API、让 `AgentService` 按 persona 聚合挂载的 KB 检索、彻底去掉 Phase 1 的 `match_knowledge_legacy` shim。

**Architecture:** 新增 `KnowledgeBaseModule`（独立模块，含 CRUD / 挂载 / 文档上传 / chunk 开关 / 命中测试）；`KnowledgeService` 方法签名从 `personaId` 切到 `kbId`，再加一个 `retrieveForPersona(personaId)` 用 `Promise.all` 并发查 persona 挂载的所有 KB，合并去重后统一 rerank；`AgentService.run` 一行改动切过去；删除老 `KnowledgeController` 与 shim RPC。

**Tech Stack:** NestJS 11 / TypeORM 0.3 / Supabase pgvector / class-validator / Swagger

**Spec:** `docs/superpowers/specs/2026-04-17-knowledge-base-platform-design.md`（Phase 2 部分）

**Prerequisite:** Phase 1 完成（tag `kb-phase1-done`）。如果 `match_knowledge_legacy` 不存在或 `knowledge_base` 表不存在，本 plan 无法执行。

---

## File Structure Map

### New files

```
digital-human-agent/src/knowledge-base/
├── knowledge-base.entity.ts              (Phase 1 已有，不改)
├── persona-knowledge-base.entity.ts      (新增，多对多挂载表 entity)
├── knowledge-base.service.ts             (新增，KB CRUD + 挂载 + chunk 管理)
├── knowledge-base.controller.ts          (新增，/knowledge-bases/*)
├── persona-knowledge-base.controller.ts  (新增，/personas/:personaId/knowledge-bases + /personas/:personaId/search)
├── knowledge-base.module.ts              (新增)
└── dto/
    ├── create-knowledge-base.dto.ts
    ├── update-knowledge-base.dto.ts
    ├── update-chunk.dto.ts
    └── attach-knowledge-base.dto.ts

digital-human-agent/supabase/migrations/
└── 007_drop_legacy_shim.sql              (新增，DROP match_knowledge_legacy)
```

### Modified files

```
digital-human-agent/src/knowledge/knowledge.service.ts
  - 新方法（kbId 版）：retrieve / retrieveWithStages / ingestDocument / listDocumentsByKb
  - 新方法：retrieveForPersona（Promise.all 多 KB 并发 + 合并去重 + 全局 rerank）
  - 新方法：updateChunkEnabled
  - 删除：旧 retrieve(personaId) / retrieveWithStages(personaId) / listDocuments(personaId) / ingestDocument(personaId)
  - 内部 RPC 调用：match_knowledge_legacy → match_knowledge（单 KB 新签名）

digital-human-agent/src/knowledge/knowledge.module.ts
  - forFeature 加 KnowledgeBase + KnowledgeChunk + PersonaKnowledgeBase entities
  - 删除 KnowledgeController 的 controllers 注册
  - export KnowledgeService（供 KnowledgeBaseModule 用）

digital-human-agent/src/knowledge/knowledge.controller.ts
  - 删除整个文件

digital-human-agent/src/agent/agent.service.ts
  - run() 里 knowledgeService.retrieve(personaId, ...) → knowledgeService.retrieveForPersona(personaId, userMessage)

digital-human-agent/src/app.module.ts
  - imports 增加 KnowledgeBaseModule

digital-human-agent/scripts/migrate.js
  - MIGRATIONS 数组追加 '007_drop_legacy_shim.sql'
```

---

## Task Sequence Rationale

我们采用**先加后切再删**的顺序，避免任何中间态破坏 HTTP API：

1. Tasks 1–5：**添加**新 entity / 新 Service 方法 / 新 Controller / 新 Module，老接口完全不动 → 此时系统有"双 API 并存"
2. Task 6：**切换** AgentService 调新 `retrieveForPersona`，`/chat` 端到端验证通过
3. Tasks 7–8：**删除** 老 `KnowledgeController` / 老 `KnowledgeService` 的 personaId 方法 / shim RPC
4. Task 9：**冒烟 + tag**

这样 Tasks 5、6、9 是三个稳定 checkpoint，中间任何任务失败都可以在 checkpoint 回滚。

---

## Task 1: PersonaKnowledgeBase entity + DTOs

**Files:**
- Create: `digital-human-agent/src/knowledge-base/persona-knowledge-base.entity.ts`
- Create: `digital-human-agent/src/knowledge-base/dto/create-knowledge-base.dto.ts`
- Create: `digital-human-agent/src/knowledge-base/dto/update-knowledge-base.dto.ts`
- Create: `digital-human-agent/src/knowledge-base/dto/update-chunk.dto.ts`
- Create: `digital-human-agent/src/knowledge-base/dto/attach-knowledge-base.dto.ts`

- [ ] **Step 1: Create PersonaKnowledgeBase entity**

```ts
// src/knowledge-base/persona-knowledge-base.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';

@Entity('persona_knowledge_base')
export class PersonaKnowledgeBase {
  @PrimaryColumn({ name: 'persona_id', type: 'uuid' })
  personaId: string;

  @PrimaryColumn({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: Create CreateKnowledgeBaseDto**

```ts
// src/knowledge-base/dto/create-knowledge-base.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class RetrievalConfigDto {
  @ApiPropertyOptional({ default: 0.6, minimum: 0, maximum: 1 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1)
  threshold?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  stage1TopK?: number;

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20)
  finalTopK?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @Type(() => Boolean) @IsBoolean()
  rerank?: boolean;
}

export class CreateKnowledgeBaseDto {
  @ApiProperty({ description: '知识库名称', example: '产品 FAQ' })
  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ description: '知识库描述' })
  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: '所属 persona（可空，为空即为公共知识库）' })
  @IsOptional() @IsUUID()
  ownerPersonaId?: string;

  @ApiPropertyOptional({ type: RetrievalConfigDto })
  @IsOptional() @IsObject() @ValidateNested() @Type(() => RetrievalConfigDto)
  retrievalConfig?: RetrievalConfigDto;
}
```

- [ ] **Step 3: Create UpdateKnowledgeBaseDto**

```ts
// src/knowledge-base/dto/update-knowledge-base.dto.ts
import { PartialType } from '@nestjs/swagger';
import { CreateKnowledgeBaseDto } from './create-knowledge-base.dto';

export class UpdateKnowledgeBaseDto extends PartialType(CreateKnowledgeBaseDto) {}
```

- [ ] **Step 4: Create UpdateChunkDto**

```ts
// src/knowledge-base/dto/update-chunk.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class UpdateChunkDto {
  @ApiProperty({ description: '是否启用该 chunk 参与检索' })
  @Type(() => Boolean) @IsBoolean()
  enabled: boolean;
}
```

- [ ] **Step 5: Create AttachKnowledgeBaseDto**

```ts
// src/knowledge-base/dto/attach-knowledge-base.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class AttachKnowledgeBaseDto {
  @ApiProperty({ description: '要挂载到当前 persona 的知识库 ID' })
  @IsUUID() @IsNotEmpty()
  knowledgeBaseId: string;
}
```

- [ ] **Step 6: tsc check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npx tsc --noEmit
```

Expected: pass（entity + DTO 都是 standalone 的，不依赖其他 Phase 2 新代码）。

- [ ] **Step 7: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/src/knowledge-base/persona-knowledge-base.entity.ts \
        digital-human-agent/src/knowledge-base/dto/
git commit -m "feat(kb): add PersonaKnowledgeBase entity + KB DTOs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 扩展 KnowledgeService（加 kbId-based 新方法，老方法暂保留）

**Files:**
- Modify: `digital-human-agent/src/knowledge/knowledge.service.ts`

策略：**新方法加在文件末尾**，老方法（`ingestDocument(personaId,...)` / `retrieve(personaId,...)` / `retrieveWithStages(personaId,...)` / `listDocuments(personaId)`）保持不变，Task 7 再删。

- [ ] **Step 1: 读取当前文件，确认 Phase 1 末状态**

```bash
head -80 /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent/src/knowledge/knowledge.service.ts
```

确认：
- `ingestDocument(personaId, filename, content, category?)` 签名仍在；内部用默认 KB 查 `knowledgeBaseId`
- `retrieveStage1` 仍调 `match_knowledge_legacy`
- `listDocuments(personaId)` 仍用 QueryBuilder + JOIN `persona_knowledge_base`

- [ ] **Step 2: 在 `KnowledgeService` 类里新增公开方法 `retrieve`（重载 kbId 版）**

**重要**：老 `retrieve(personaId, ...)` 需要保留直到 Task 7。因此新方法换名为 `retrieveByKb`；Task 7 会 rename 为 `retrieve`。

在类里加：

```ts
async retrieveByKb(
  kbId: string,
  query: string,
  options: RetrieveKnowledgeOptions = {},
): Promise<KnowledgeChunk[]> {
  try {
    const result = await this.retrieveWithStagesByKb(kbId, query, options);
    return result.stage2;
  } catch (error) {
    this.logger.warn(
      `知识检索失败（kb=${kbId}），降级为空知识：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}

async retrieveWithStagesByKb(
  kbId: string,
  query: string,
  options: RetrieveKnowledgeOptions = {},
): Promise<RetrieveKnowledgeDebugResult> {
  const normalizedQuery = query.trim();
  const normalizedOptions = this.normalizeRetrieveOptions(options);

  if (!normalizedQuery) {
    return {
      query: normalizedQuery,
      options: normalizedOptions,
      stage1: [],
      stage2: [],
    };
  }

  const queryEmbedding = await this.withTransientRetry(
    'embed query',
    () => this.embeddings.embedQuery(normalizedQuery),
    3,
  );

  const stage1 = await this.retrieveStage1ByKb(
    kbId,
    queryEmbedding,
    normalizedOptions.threshold,
    normalizedOptions.stage1TopK,
  );

  let stage2 = stage1.slice(0, normalizedOptions.finalTopK);
  if (normalizedOptions.rerank && stage1.length > 1) {
    try {
      stage2 = await this.rerankerService.rerank(
        normalizedQuery,
        stage1,
        normalizedOptions.finalTopK,
      );
    } catch (error) {
      this.logger.warn(
        `Reranker 失败，回退为向量检索结果：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    query: normalizedQuery,
    options: normalizedOptions,
    stage1,
    stage2,
  };
}

private async retrieveStage1ByKb(
  kbId: string,
  queryEmbedding: number[],
  threshold: number,
  matchCount: number,
): Promise<KnowledgeChunk[]> {
  const { data, error } = await this.withTransientRetry<{
    data: KnowledgeChunk[] | null;
    error: { message: string } | null;
  }>(
    'match_knowledge rpc',
    async () => {
      const result = await this.supabase.rpc('match_knowledge', {
        query_embedding: queryEmbedding,
        p_kb_id: kbId,
        match_threshold: threshold,
        match_count: matchCount,
      });
      return {
        data: (result.data as KnowledgeChunk[] | null) ?? null,
        error: result.error ? { message: result.error.message } : null,
      };
    },
    3,
  );

  if (error) throw new Error(error.message);
  return (data as KnowledgeChunk[]) ?? [];
}
```

- [ ] **Step 3: 新增 `retrieveForPersona`**

在同一类里加：

```ts
/**
 * persona 聚合检索：查 persona 挂载的所有 KB，各自按 retrievalConfig 并发 stage1，
 * 合并去重后统一 rerank。
 *
 * Stage1 参数（threshold / stage1TopK）按每个 KB 独立生效；
 * Stage2 的 rerank / finalTopK 使用全局兜底值（5）。
 */
async retrieveForPersona(
  personaId: string,
  query: string,
): Promise<KnowledgeChunk[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  // 1. 两步查 persona 挂载的 KB + 各自的 retrieval_config
  //    （不用 PostgREST 内联 join，避免 FK 元数据依赖，更稳）
  const { data: mountRows, error: mountErr } = await this.supabase
    .from('persona_knowledge_base')
    .select('knowledge_base_id')
    .eq('persona_id', personaId);

  if (mountErr) {
    this.logger.warn(
      `查询 persona ${personaId} 挂载失败：${mountErr.message}`,
    );
    return [];
  }
  if (!mountRows || mountRows.length === 0) {
    this.logger.log(`persona ${personaId} 未挂载任何知识库`);
    return [];
  }
  const kbIds = mountRows.map((r) => r.knowledge_base_id as string);

  const { data: kbRows, error: kbErr } = await this.supabase
    .from('knowledge_base')
    .select('id, retrieval_config')
    .in('id', kbIds);

  if (kbErr || !kbRows || kbRows.length === 0) {
    if (kbErr) {
      this.logger.warn(`查询 KB 配置失败：${kbErr.message}`);
    }
    return [];
  }

  // 2. 计算 query embedding（全局复用）
  const queryEmbedding = await this.withTransientRetry(
    'embed query',
    () => this.embeddings.embedQuery(normalizedQuery),
    3,
  );

  // 3. 并发 stage1，每个 KB 用自己的 threshold / stage1TopK
  const perKbOptions = kbRows.map((kb) => {
    const cfg = (kb.retrieval_config as Partial<KnowledgeBaseRetrievalConfig>) ?? {};
    return {
      kbId: kb.id as string,
      threshold: this.toNumber(cfg.threshold, 0.6, 0, 1),
      stage1TopK: this.toNumber(cfg.stage1TopK, 20, 1, 50),
    };
  });

  const stage1Results = await Promise.all(
    perKbOptions.map(async (o) => {
      try {
        return await this.retrieveStage1ByKb(
          o.kbId,
          queryEmbedding,
          o.threshold,
          o.stage1TopK,
        );
      } catch (e) {
        this.logger.warn(
          `stage1 失败（kb=${o.kbId}）：${e instanceof Error ? e.message : String(e)}`,
        );
        return [] as KnowledgeChunk[];
      }
    }),
  );

  // 4. 合并去重（同一 chunk.id 保留 similarity 最高的那条）
  const dedup = new Map<string, KnowledgeChunk>();
  for (const chunks of stage1Results) {
    for (const c of chunks) {
      const existing = dedup.get(c.id);
      if (!existing || (c.similarity ?? 0) > (existing.similarity ?? 0)) {
        dedup.set(c.id, c);
      }
    }
  }

  const merged = Array.from(dedup.values()).sort(
    (a, b) => (b.similarity ?? 0) - (a.similarity ?? 0),
  );

  // 5. 截断 stage1TopK：取各 KB 里最大的那个（但不少于 20）
  const globalStage1TopK = Math.max(
    20,
    ...perKbOptions.map((o) => o.stage1TopK),
  );
  const stage1Final = merged.slice(0, globalStage1TopK);

  // 6. 全局 rerank；finalTopK 固定为 5（persona 级兜底）
  const GLOBAL_FINAL_TOPK = 5;
  if (stage1Final.length <= 1) return stage1Final;

  try {
    return await this.rerankerService.rerank(
      normalizedQuery,
      stage1Final,
      GLOBAL_FINAL_TOPK,
    );
  } catch (e) {
    this.logger.warn(
      `全局 rerank 失败，回退向量排序：${e instanceof Error ? e.message : String(e)}`,
    );
    return stage1Final.slice(0, GLOBAL_FINAL_TOPK);
  }
}
```

**Import 补充**：在文件顶部 import 部分加：

```ts
import type { KnowledgeBaseRetrievalConfig } from '../knowledge-base/knowledge-base.entity';
```

- [ ] **Step 4: 新增 `ingestDocumentByKb`（kbId 版）**

在类里加：

```ts
async ingestDocumentByKb(
  kbId: string,
  filename: string,
  content: string,
  opts: { mimeType?: string; fileSize?: number; category?: string } = {},
): Promise<KnowledgeDocument> {
  // 1. 创建文档记录
  const doc = await this.docRepo.save(
    this.docRepo.create({
      knowledgeBaseId: kbId,
      filename,
      status: 'processing',
      mimeType: opts.mimeType ?? null,
      fileSize: opts.fileSize ?? null,
    }),
  );

  try {
    // 2. 切分
    const chunks = await this.splitter.createDocuments([content]);
    this.logger.log(
      `[切分完成] filename=${filename} chunks=${chunks.length}`,
    );

    // 3. 向量化
    const texts = chunks.map((c) => c.pageContent);
    this.logger.log(
      `[开始 Embedding] model=${this.embeddings.model} texts=${texts.length}`,
    );
    const embeddings = await this.embeddings.embedDocuments(texts);
    this.logger.log(`[Embedding 完成] dims=${embeddings[0]?.length}`);

    // 4. 写入 Supabase
    const rows = chunks.map((chunk, i) => ({
      document_id: doc.id,
      chunk_index: i,
      content: chunk.pageContent,
      source: filename,
      category: opts.category ?? null,
      embedding: JSON.stringify(embeddings[i]),
    }));
    this.logger.log(`[开始 Insert] rows=${rows.length}`);

    const BATCH_SIZE = 50;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const result = await this.withTransientRetry<{
        error: { message: string } | null;
      }>(
        `insert batch ${Math.floor(i / BATCH_SIZE) + 1}`,
        async () => {
          const r = await this.supabase.from('knowledge_chunk').insert(batch);
          return { error: r.error ? { message: r.error.message } : null };
        },
        3,
      );
      if (result.error) throw new Error(result.error.message);
    }
    this.logger.log(
      `[Insert 完成] doc=${doc.id} batches=${Math.ceil(rows.length / BATCH_SIZE)}`,
    );

    // 5. 更新状态
    await this.docRepo.update(doc.id, {
      status: 'completed',
      chunkCount: chunks.length,
    });

    return this.docRepo.findOneBy({
      id: doc.id,
    }) as Promise<KnowledgeDocument>;
  } catch (err) {
    this.logger.error('Ingest failed', err);
    await this.docRepo.update(doc.id, { status: 'failed' });
    throw err;
  }
}
```

- [ ] **Step 5: 新增 `listDocumentsByKb` + `updateChunkEnabled`**

```ts
listDocumentsByKb(kbId: string): Promise<KnowledgeDocument[]> {
  return this.docRepo.find({
    where: { knowledgeBaseId: kbId },
    order: { createdAt: 'DESC' },
  });
}

async updateChunkEnabled(chunkId: string, enabled: boolean): Promise<void> {
  const { error } = await this.supabase
    .from('knowledge_chunk')
    .update({ enabled })
    .eq('id', chunkId);
  if (error) throw new Error(error.message);
}

listChunksByDocumentId(
  documentId: string,
): Promise<
  Array<{
    id: string;
    chunkIndex: number;
    content: string;
    charCount: number;
    enabled: boolean;
    source: string;
    category: string | null;
  }>
> {
  return this.chunkRepo
    .createQueryBuilder('c')
    .where('c.document_id = :documentId', { documentId })
    .orderBy('c.chunk_index', 'ASC')
    .getMany();
}
```

- [ ] **Step 6: 注入 `chunkRepo`**

找到 constructor：

```ts
constructor(
  @InjectRepository(KnowledgeDocument)
  private readonly docRepo: Repository<KnowledgeDocument>,
  @Inject(SUPABASE_CLIENT)
  private readonly supabase: SupabaseClient,
  private readonly rerankerService: RerankerService,
) {}
```

改为：

```ts
constructor(
  @InjectRepository(KnowledgeDocument)
  private readonly docRepo: Repository<KnowledgeDocument>,
  @InjectRepository(KnowledgeChunk)
  private readonly chunkRepo: Repository<KnowledgeChunk>,
  @Inject(SUPABASE_CLIENT)
  private readonly supabase: SupabaseClient,
  private readonly rerankerService: RerankerService,
) {}
```

在文件顶部 import 部分加：

```ts
import { KnowledgeChunk } from './knowledge-chunk.entity';
```

**注意**：此改动要求 Task 3 把 `KnowledgeChunk` 注册到 `KnowledgeModule` 的 `forFeature`。Task 3 尚未执行，TypeScript 编译会通过但运行时 DI 会报错。因此**本任务只做 tsc 验证，不跑 dev server**。

- [ ] **Step 7: tsc check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npx tsc --noEmit
```

Expected: pass。

- [ ] **Step 8: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/src/knowledge/knowledge.service.ts
git commit -m "feat(kb): add kb-id based methods to KnowledgeService

- retrieveByKb / retrieveWithStagesByKb (single-KB search, calls new match_knowledge RPC)
- retrieveForPersona (Promise.all fan-out over mounted KBs + dedupe + global rerank)
- ingestDocumentByKb (kb-scoped upload path, accepts mimeType/fileSize/category)
- listDocumentsByKb
- listChunksByDocumentId (TypeORM-backed chunk enumeration)
- updateChunkEnabled (SQL-level enable/disable)

Old persona-scoped methods retained; Task 7 removes them after callers migrate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 注册新 entities 到 KnowledgeModule

**Files:**
- Modify: `digital-human-agent/src/knowledge/knowledge.module.ts`

- [ ] **Step 1: 用新内容替换 knowledge.module.ts**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeDocument } from './knowledge-document.entity';
import { KnowledgeChunk } from './knowledge-chunk.entity';
import { KnowledgeBase } from '../knowledge-base/knowledge-base.entity';
import { PersonaKnowledgeBase } from '../knowledge-base/persona-knowledge-base.entity';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { RerankerService } from './reranker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeDocument,
      KnowledgeChunk,
      KnowledgeBase,
      PersonaKnowledgeBase,
    ]),
  ],
  providers: [KnowledgeService, RerankerService],
  controllers: [KnowledgeController],
  exports: [KnowledgeService, TypeOrmModule],
})
export class KnowledgeModule {}
```

**说明**：
- `KnowledgeChunk` 是 `KnowledgeService` 新方法需要的
- `KnowledgeBase` + `PersonaKnowledgeBase` 是为了让 Task 4 的 `KnowledgeBaseService` 可以通过 `TypeOrmModule` 取 repo（因为 `KnowledgeBaseModule` 会 import `KnowledgeModule` → export 的 TypeOrmModule 里有这些 entity）
- `KnowledgeController` 注册**保留**（Task 7 删）
- export `TypeOrmModule` 把 entity 的 `Repository<T>` 传递给 KnowledgeBaseModule

- [ ] **Step 2: tsc check + dev server 启动校验（不测 HTTP）**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npx tsc --noEmit
# 确保 port 3001 空闲
lsof -iTCP:3001 -sTCP:LISTEN -n -P
# 启动 3 秒看是否有 DI 错误
timeout 8 npm run start:dev 2>&1 | tail -30 | grep -i -E "error|LOG.*NestApplication" || echo "(no errors)"
```

Expected: 看到 `Nest application successfully started`，没有 `Error: Nest can't resolve dependencies` 之类的报错。

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/src/knowledge/knowledge.module.ts
git commit -m "feat(kb): register new entities in KnowledgeModule and export TypeOrmModule

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: KnowledgeBaseService

**Files:**
- Create: `digital-human-agent/src/knowledge-base/knowledge-base.service.ts`

- [ ] **Step 1: 写 service**

```ts
// src/knowledge-base/knowledge-base.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeBase, KnowledgeBaseRetrievalConfig } from './knowledge-base.entity';
import { PersonaKnowledgeBase } from './persona-knowledge-base.entity';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';

const DEFAULT_RETRIEVAL_CONFIG: KnowledgeBaseRetrievalConfig = {
  threshold: 0.6,
  stage1TopK: 20,
  finalTopK: 5,
  rerank: true,
};

@Injectable()
export class KnowledgeBaseService {
  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(PersonaKnowledgeBase)
    private readonly mountRepo: Repository<PersonaKnowledgeBase>,
  ) {}

  listAll(): Promise<KnowledgeBase[]> {
    return this.kbRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<KnowledgeBase> {
    const kb = await this.kbRepo.findOneBy({ id });
    if (!kb) throw new NotFoundException(`知识库 ${id} 不存在`);
    return kb;
  }

  async create(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const retrievalConfig: KnowledgeBaseRetrievalConfig = {
      ...DEFAULT_RETRIEVAL_CONFIG,
      ...(dto.retrievalConfig ?? {}),
    };

    return this.kbRepo.save(
      this.kbRepo.create({
        name: dto.name,
        description: dto.description ?? null,
        ownerPersonaId: dto.ownerPersonaId ?? null,
        retrievalConfig,
      }),
    );
  }

  async update(id: string, dto: UpdateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const kb = await this.findOne(id);

    if (dto.name !== undefined) kb.name = dto.name;
    if (dto.description !== undefined) kb.description = dto.description ?? null;
    if (dto.ownerPersonaId !== undefined) {
      kb.ownerPersonaId = dto.ownerPersonaId ?? null;
    }
    if (dto.retrievalConfig !== undefined) {
      kb.retrievalConfig = {
        ...kb.retrievalConfig,
        ...dto.retrievalConfig,
      };
    }

    return this.kbRepo.save(kb);
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const result = await this.kbRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`知识库 ${id} 不存在`);
    }
    return { id, deleted: true };
  }

  async listKbsForPersona(personaId: string): Promise<KnowledgeBase[]> {
    return this.kbRepo
      .createQueryBuilder('kb')
      .innerJoin(
        'persona_knowledge_base',
        'pkb',
        'pkb.knowledge_base_id = kb.id',
      )
      .where('pkb.persona_id = :personaId', { personaId })
      .orderBy('kb.created_at', 'DESC')
      .getMany();
  }

  async listPersonaIdsForKb(kbId: string): Promise<string[]> {
    const rows = await this.mountRepo.find({
      where: { knowledgeBaseId: kbId },
      select: ['personaId'],
    });
    return rows.map((r) => r.personaId);
  }

  async attachPersona(personaId: string, kbId: string): Promise<void> {
    await this.findOne(kbId); // 404 if missing
    const existing = await this.mountRepo.findOneBy({
      personaId,
      knowledgeBaseId: kbId,
    });
    if (existing) {
      throw new BadRequestException('该知识库已挂载到此 persona');
    }
    await this.mountRepo.save(
      this.mountRepo.create({ personaId, knowledgeBaseId: kbId }),
    );
  }

  async detachPersona(personaId: string, kbId: string): Promise<void> {
    const result = await this.mountRepo.delete({
      personaId,
      knowledgeBaseId: kbId,
    });
    if (result.affected === 0) {
      throw new NotFoundException('挂载关系不存在');
    }
  }
}
```

- [ ] **Step 2: tsc check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npx tsc --noEmit
```

Expected: pass（entity + DTO + Repository 都已就位）。

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/src/knowledge-base/knowledge-base.service.ts
git commit -m "feat(kb): add KnowledgeBaseService (CRUD + persona attach/detach)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Controllers + Module 注册

**Files:**
- Create: `digital-human-agent/src/knowledge-base/knowledge-base.controller.ts`
- Create: `digital-human-agent/src/knowledge-base/persona-knowledge-base.controller.ts`
- Create: `digital-human-agent/src/knowledge-base/knowledge-base.module.ts`
- Modify: `digital-human-agent/src/app.module.ts`

- [ ] **Step 1: KnowledgeBaseController（/knowledge-bases/*）**

```ts
// src/knowledge-base/knowledge-base.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { extname } from 'node:path';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { KnowledgeSearchDto } from '../knowledge/dto/knowledge-search.dto';
import { KnowledgeBaseService } from './knowledge-base.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';
import { UpdateChunkDto } from './dto/update-chunk.dto';

@ApiTags('knowledge-bases')
@Controller('knowledge-bases')
export class KnowledgeBaseController {
  constructor(
    private readonly kbService: KnowledgeBaseService,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  // -------- KB CRUD --------

  @Get()
  listAll() {
    return this.kbService.listAll();
  }

  @Post()
  create(@Body() dto: CreateKnowledgeBaseDto) {
    return this.kbService.create(dto);
  }

  @Get(':kbId')
  findOne(@Param('kbId', ParseUUIDPipe) kbId: string) {
    return this.kbService.findOne(kbId);
  }

  @Patch(':kbId')
  update(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Body() dto: UpdateKnowledgeBaseDto,
  ) {
    return this.kbService.update(kbId, dto);
  }

  @Delete(':kbId')
  @ApiOperation({ summary: '删除知识库（级联文档 + chunks）' })
  remove(@Param('kbId', ParseUUIDPipe) kbId: string) {
    return this.kbService.remove(kbId);
  }

  // -------- KB 下的文档管理 --------

  @Get(':kbId/documents')
  listDocuments(@Param('kbId', ParseUUIDPipe) kbId: string) {
    return this.knowledgeService.listDocumentsByKb(kbId);
  }

  @Post(':kbId/documents')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('缺少上传文件，请使用 file 字段上传');
    }
    const content = await this.extractDocumentText(file);
    return this.knowledgeService.ingestDocumentByKb(
      kbId,
      file.originalname,
      content,
      {
        mimeType: file.mimetype,
        fileSize: file.size,
        category,
      },
    );
  }

  @Delete(':kbId/documents/:docId')
  deleteDocument(
    @Param('kbId', ParseUUIDPipe) _kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.knowledgeService.deleteDocument(docId);
  }

  @Get(':kbId/documents/:docId/chunks')
  listChunks(
    @Param('kbId', ParseUUIDPipe) _kbId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.knowledgeService.listChunksByDocumentId(docId);
  }

  // -------- Chunk 启用/禁用 --------

  @Patch(':kbId/chunks/:chunkId')
  @ApiOperation({ summary: '启用或禁用单个 chunk' })
  async updateChunk(
    @Param('kbId', ParseUUIDPipe) _kbId: string,
    @Param('chunkId', ParseUUIDPipe) chunkId: string,
    @Body() dto: UpdateChunkDto,
  ) {
    await this.knowledgeService.updateChunkEnabled(chunkId, dto.enabled);
    return { chunkId, enabled: dto.enabled };
  }

  // -------- 单 KB 命中测试 --------

  @Post(':kbId/search')
  @ApiOperation({ summary: '命中测试（stage1 + stage2，单 KB）' })
  search(
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Body() body: KnowledgeSearchDto,
  ) {
    return this.knowledgeService.retrieveWithStagesByKb(kbId, body.query, {
      rerank: body.rerank,
      threshold: body.threshold,
      stage1TopK: body.stage1TopK,
      finalTopK: body.finalTopK,
    });
  }

  // -------- 文档文本抽取（从老 KnowledgeController 复用）--------

  private async extractDocumentText(
    file: Express.Multer.File,
  ): Promise<string> {
    const ext = extname(file.originalname ?? '').toLowerCase();
    const mime = String(file.mimetype ?? '').toLowerCase();

    if (ext === '.pdf' || mime === 'application/pdf') {
      const mod = await import('pdf-parse');
      const parser = new mod.PDFParse({ data: file.buffer });
      let parsedText = '';
      try {
        const parsed = await parser.getText();
        parsedText = String(parsed?.text ?? '').trim();
      } finally {
        await parser.destroy();
      }
      if (!parsedText) {
        throw new BadRequestException('PDF 未解析到可用文本');
      }
      return parsedText;
    }

    const textExtensions = new Set([
      '.txt',
      '.md',
      '.markdown',
      '.csv',
      '.json',
      '.log',
    ]);
    if (mime.startsWith('text/') || textExtensions.has(ext)) {
      const text = file.buffer.toString('utf-8').trim();
      if (!text) {
        throw new BadRequestException('文档内容为空');
      }
      return text;
    }

    throw new BadRequestException('仅支持 txt、md、pdf 文档上传');
  }
}
```

- [ ] **Step 2: PersonaKnowledgeBaseController（/personas/:personaId/knowledge-bases + /personas/:personaId/search）**

```ts
// src/knowledge-base/persona-knowledge-base.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { AttachKnowledgeBaseDto } from './dto/attach-knowledge-base.dto';

@ApiTags('persona-knowledge-bases')
@Controller('personas/:personaId')
export class PersonaKnowledgeBaseController {
  constructor(
    private readonly kbService: KnowledgeBaseService,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  @Get('knowledge-bases')
  @ApiOperation({ summary: '列出 persona 已挂载的知识库' })
  listMounted(@Param('personaId', ParseUUIDPipe) personaId: string) {
    return this.kbService.listKbsForPersona(personaId);
  }

  @Post('knowledge-bases')
  @ApiOperation({ summary: '挂载知识库到 persona' })
  async attach(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() dto: AttachKnowledgeBaseDto,
  ) {
    await this.kbService.attachPersona(personaId, dto.knowledgeBaseId);
    return { personaId, knowledgeBaseId: dto.knowledgeBaseId, attached: true };
  }

  @Delete('knowledge-bases/:kbId')
  @ApiOperation({ summary: '解除挂载' })
  async detach(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Param('kbId', ParseUUIDPipe) kbId: string,
  ) {
    await this.kbService.detachPersona(personaId, kbId);
    return { personaId, knowledgeBaseId: kbId, attached: false };
  }

  @Post('search')
  @ApiOperation({
    summary: 'persona 聚合命中测试（并查所有挂载 KB + 合并 + 全局 rerank）',
  })
  async search(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body('query') query: string,
  ) {
    const chunks = await this.knowledgeService.retrieveForPersona(
      personaId,
      String(query ?? ''),
    );
    return { query, results: chunks };
  }
}
```

- [ ] **Step 3: KnowledgeBaseModule**

```ts
// src/knowledge-base/knowledge-base.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { KnowledgeBase } from './knowledge-base.entity';
import { PersonaKnowledgeBase } from './persona-knowledge-base.entity';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { PersonaKnowledgeBaseController } from './persona-knowledge-base.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeBase, PersonaKnowledgeBase]),
    KnowledgeModule, // 拿 KnowledgeService
  ],
  providers: [KnowledgeBaseService],
  controllers: [KnowledgeBaseController, PersonaKnowledgeBaseController],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
```

- [ ] **Step 4: 注册到 AppModule**

Modify `digital-human-agent/src/app.module.ts`:

在 imports 数组里的 `KnowledgeModule` 后面加 `KnowledgeBaseModule`。

```ts
// 顶部 import 部分
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';

// imports 数组
imports: [
  ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
  DatabaseModule,
  PersonaModule,
  ConversationModule,
  KnowledgeModule,
  KnowledgeBaseModule,   // <-- 这一行
  AsrModule,
  TtsModule,
  // ... 其余不变
]
```

- [ ] **Step 5: tsc check + dev server smoke**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npx tsc --noEmit

# 确保没有 server 在跑
lsof -iTCP:3001 -sTCP:LISTEN -n -P || echo "port free"

# 启动 dev server
npm run start:dev &
SERVER_PID=$!
sleep 10

# smoke：列出 KB + 挂载关系
curl -s http://localhost:3001/knowledge-bases | python3 -m json.tool | head -20
curl -s http://localhost:3001/personas/491a6f8f-739a-47ff-94fa-6382ed79baf9/knowledge-bases | python3 -m json.tool

# smoke：新命中测试路径
curl -s -X POST http://localhost:3001/knowledge-bases/$(curl -s http://localhost:3001/knowledge-bases | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")/search \
  -H 'content-type: application/json' \
  -d '{"query":"提示词 模板","rerank":false,"finalTopK":3}' | python3 -m json.tool | head -30

# 停 server
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null
```

Expected:
- `GET /knowledge-bases`：返回至少 1 个 KB（Phase 1 为每个 persona 建了默认 KB）
- `GET /personas/:personaId/knowledge-bases`：返回 1 个（默认 KB）
- `POST /knowledge-bases/:kbId/search`：返回 `stage1` 数组非空

老 `/knowledge/:personaId/search` 也仍然工作（没删）。

- [ ] **Step 6: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/src/knowledge-base/knowledge-base.controller.ts \
        digital-human-agent/src/knowledge-base/persona-knowledge-base.controller.ts \
        digital-human-agent/src/knowledge-base/knowledge-base.module.ts \
        digital-human-agent/src/app.module.ts
git commit -m "feat(kb): add KnowledgeBase controllers (/knowledge-bases + /personas/:id) and register module

- KnowledgeBaseController: CRUD, document upload/list/delete, chunk list/enable, single-KB hit test
- PersonaKnowledgeBaseController: mount/unmount, persona-aggregated hit test
- KnowledgeBaseModule wires everything and re-exports KnowledgeBaseService
- AppModule imports the new module

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: AgentService 切到 retrieveForPersona

**Files:**
- Modify: `digital-human-agent/src/agent/agent.service.ts`

- [ ] **Step 1: 定位并替换 retrieve 调用**

原代码（agent.service.ts 第 55-65 行附近）：

```ts
const chunks: KnowledgeChunk[] = await this.knowledgeService.retrieve(
  personaId,
  userMessage,
  {
    rerank: true,
    stage1TopK: 20,
    finalTopK: 5,
    threshold: 0.6,
  },
);
```

替换为：

```ts
const chunks: KnowledgeChunk[] =
  await this.knowledgeService.retrieveForPersona(personaId, userMessage);
```

（`retrieveForPersona` 内部已处理 threshold / stage1TopK / rerank / finalTopK，并支持 per-KB 配置，不需要再传 options。）

- [ ] **Step 2: tsc check + /chat 冒烟**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npx tsc --noEmit

lsof -iTCP:3001 -sTCP:LISTEN -n -P || echo "port free"
npm run start:dev &
SERVER_PID=$!
sleep 10

curl -s -N -X POST http://localhost:3001/chat \
  -H 'content-type: application/json' \
  -d '{"personaId":"491a6f8f-739a-47ff-94fa-6382ed79baf9","message":"这个提示词模板是做什么用的？"}' \
  --max-time 30 2>&1 | head -6

kill $SERVER_PID
wait $SERVER_PID 2>/dev/null
```

Expected: 看到 `"type":"message-metadata"` 事件里包含 citations 数组，`"type":"text-delta"` 事件正常流回。

- [ ] **Step 3: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/src/agent/agent.service.ts
git commit -m "feat(agent): switch to retrieveForPersona for kb-aware retrieval

Agent now fans out over all KBs mounted to the persona, each with its
own retrievalConfig, then does a single global rerank.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 删除老 KnowledgeController + 老 KnowledgeService 方法 + 清理命名

**Files:**
- Delete: `digital-human-agent/src/knowledge/knowledge.controller.ts`
- Modify: `digital-human-agent/src/knowledge/knowledge.module.ts`
- Modify: `digital-human-agent/src/knowledge/knowledge.service.ts`
- Modify: `digital-human-agent/src/knowledge-base/knowledge-base.controller.ts` (rename calls)
- Modify: `digital-human-agent/src/knowledge-base/persona-knowledge-base.controller.ts` (rename calls, if any)

- [ ] **Step 1: 删掉 KnowledgeController 文件**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
rm digital-human-agent/src/knowledge/knowledge.controller.ts
```

- [ ] **Step 2: 从 KnowledgeModule 移除 controller 注册**

```ts
// src/knowledge/knowledge.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeDocument } from './knowledge-document.entity';
import { KnowledgeChunk } from './knowledge-chunk.entity';
import { KnowledgeBase } from '../knowledge-base/knowledge-base.entity';
import { PersonaKnowledgeBase } from '../knowledge-base/persona-knowledge-base.entity';
import { KnowledgeService } from './knowledge.service';
import { RerankerService } from './reranker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeDocument,
      KnowledgeChunk,
      KnowledgeBase,
      PersonaKnowledgeBase,
    ]),
  ],
  providers: [KnowledgeService, RerankerService],
  exports: [KnowledgeService, TypeOrmModule],
})
export class KnowledgeModule {}
```

- [ ] **Step 3: 从 KnowledgeService 删除老方法并重命名新方法**

在 `knowledge.service.ts` 里：

删除以下方法：
- `ingestDocument(personaId, ...)` 完整方法体（带默认 KB 解析 + supabase insert）
- `retrieve(personaId, ...)` 方法
- `retrieveWithStages(personaId, ...)` 方法
- `listDocuments(personaId)` 方法
- `retrieveStage1(personaId, ...)` 方法（调 `match_knowledge_legacy` 的那个）

重命名（rename）：
- `ingestDocumentByKb` → `ingestDocument`
- `retrieveByKb` → `retrieve`
- `retrieveWithStagesByKb` → `retrieveWithStages`
- `retrieveStage1ByKb` → `retrieveStage1`
- `listDocumentsByKb` → `listDocumentsByKb`（**保持 ByKb 后缀**，与 `retrieveForPersona` 形成语义对应）

保留不变：
- `retrieveForPersona`
- `updateChunkEnabled`
- `listChunksByDocumentId`
- `deleteDocument`

**建议实操步骤**：用编辑器正则 `find & replace` 逐个 rename，rename 完后手动删除老方法块。

- [ ] **Step 4: 更新 KnowledgeBaseController 里的方法名引用**

把 `knowledge-base.controller.ts` 里所有：
- `knowledgeService.retrieveByKb` → `knowledgeService.retrieve`
- `knowledgeService.retrieveWithStagesByKb` → `knowledgeService.retrieveWithStages`
- `knowledgeService.ingestDocumentByKb` → `knowledgeService.ingestDocument`

`listDocumentsByKb` 保留不变。

- [ ] **Step 5: tsc check**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npx tsc --noEmit
```

Expected: pass。如果有其他文件还在调老方法，此处会报错。常见可能受影响的地方：
- `AgentService.run`（Task 6 已切到 `retrieveForPersona`，应该无引用）
- 前端仅通过 HTTP 调用，不受影响

- [ ] **Step 6: dev server smoke**

```bash
npm run start:dev &
SERVER_PID=$!
sleep 10

# 新路由可用
curl -s http://localhost:3001/knowledge-bases | python3 -m json.tool | head -10

# 老路由应该 404
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/knowledge/491a6f8f-739a-47ff-94fa-6382ed79baf9/documents
# Expected: 404

# /chat 仍然 OK
curl -s -N -X POST http://localhost:3001/chat \
  -H 'content-type: application/json' \
  -d '{"personaId":"491a6f8f-739a-47ff-94fa-6382ed79baf9","message":"模板做什么？"}' \
  --max-time 30 2>&1 | grep -c "text-delta"
# Expected: > 0

kill $SERVER_PID
wait $SERVER_PID 2>/dev/null
```

- [ ] **Step 7: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/src/knowledge/knowledge.controller.ts \
        digital-human-agent/src/knowledge/knowledge.module.ts \
        digital-human-agent/src/knowledge/knowledge.service.ts \
        digital-human-agent/src/knowledge-base/knowledge-base.controller.ts
git commit -m "refactor(kb): remove legacy KnowledgeController + persona-scoped service methods

- delete src/knowledge/knowledge.controller.ts (routes moved to /knowledge-bases/*)
- drop persona-scoped retrieve/retrieveWithStages/listDocuments/ingestDocument
- rename retrieveByKb/ingestDocumentByKb/retrieveWithStagesByKb to their
  canonical names now that no ambiguity remains
- update KnowledgeBaseController callers to new names

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 删除 match_knowledge_legacy shim（Migration 007）

**Files:**
- Create: `digital-human-agent/supabase/migrations/007_drop_legacy_shim.sql`
- Modify: `digital-human-agent/scripts/migrate.js`

- [ ] **Step 1: 写 migration**

```sql
-- 007_drop_legacy_shim.sql
-- 目的：删除 Phase 1 的 match_knowledge_legacy 过渡 shim。
-- Phase 2 结束后 AgentService 已切到 retrieveForPersona，直接调新 match_knowledge RPC，
-- 不再需要 persona_id → kb_ids 的 SQL 级翻译。

DROP FUNCTION IF EXISTS match_knowledge_legacy(VECTOR, UUID, FLOAT, INT);
```

- [ ] **Step 2: 注册到 migrate.js**

打开 `digital-human-agent/scripts/migrate.js`，把 `MIGRATIONS` 数组改为：

```js
const MIGRATIONS = [
  '001_init.sql',
  '002_rpc.sql',
  '003_knowledge_base.sql',
  '004_migrate_documents.sql',
  '005_knowledge_chunk.sql',
  '006_rpc_rewrite.sql',
  '007_drop_legacy_shim.sql',
];
```

- [ ] **Step 3: 停 server + 跑迁移**

```bash
lsof -iTCP:3001 -sTCP:LISTEN -n -P 2>&1 | head -3
# 若有 PID，kill 掉

cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npm run db:migrate
```

Expected output: 003-006 都被 skipped（幂等），007 显示 `✅ 007_drop_legacy_shim.sql done`。

- [ ] **Step 4: 验证 legacy shim 已消失**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
node -e "
const { Client } = require('pg');
require('dotenv').config();
const c = new Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false }});
(async () => {
  await c.connect();
  const r = await c.query(\"SELECT proname FROM pg_proc WHERE proname LIKE 'match_knowledge%' ORDER BY proname\");
  console.log('remaining match_knowledge functions:', r.rows.map(x => x.proname).join(', '));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
"
```

Expected: `remaining match_knowledge functions: match_knowledge`（只剩新签名，legacy 已去）。

- [ ] **Step 5: Commit**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git add digital-human-agent/supabase/migrations/007_drop_legacy_shim.sql \
        digital-human-agent/scripts/migrate.js
git commit -m "chore(db): drop match_knowledge_legacy shim (migration 007)

AgentService and KnowledgeService have moved off the persona_id-based
legacy RPC; the shim is no longer referenced.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: 最终冒烟测试 + tag

**Files:** 无

- [ ] **Step 1: 完整启动 + 巡检**

```bash
cd /Users/wei.he/Documents/GitHub/ai-agent-course-code/digital-human-agent
npm run start:dev &
SERVER_PID=$!
sleep 10
```

- [ ] **Step 2: KB CRUD**

```bash
# create
NEW_KB=$(curl -s -X POST http://localhost:3001/knowledge-bases \
  -H 'content-type: application/json' \
  -d '{"name":"phase2-smoke","description":"smoke test kb"}')
echo "$NEW_KB"
NEW_KB_ID=$(echo "$NEW_KB" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
echo "NEW_KB_ID=$NEW_KB_ID"

# update retrievalConfig
curl -s -X PATCH http://localhost:3001/knowledge-bases/$NEW_KB_ID \
  -H 'content-type: application/json' \
  -d '{"retrievalConfig":{"threshold":0.5}}' | python3 -m json.tool | head -20

# delete
curl -s -X DELETE http://localhost:3001/knowledge-bases/$NEW_KB_ID
```

Expected: 三次调用都成功。

- [ ] **Step 3: 挂载/解除挂载**

```bash
PERSONA_ID=491a6f8f-739a-47ff-94fa-6382ed79baf9
DEFAULT_KB=$(curl -s http://localhost:3001/personas/$PERSONA_ID/knowledge-bases | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
echo "DEFAULT_KB=$DEFAULT_KB"

# 再建一个 KB 用于挂载
NEW_KB_ID=$(curl -s -X POST http://localhost:3001/knowledge-bases -H 'content-type: application/json' \
  -d '{"name":"extra-kb"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")

# 挂到 persona
curl -s -X POST http://localhost:3001/personas/$PERSONA_ID/knowledge-bases \
  -H 'content-type: application/json' \
  -d "{\"knowledgeBaseId\":\"$NEW_KB_ID\"}"

# 列出
curl -s http://localhost:3001/personas/$PERSONA_ID/knowledge-bases | python3 -m json.tool | head -30

# 解除
curl -s -X DELETE http://localhost:3001/personas/$PERSONA_ID/knowledge-bases/$NEW_KB_ID

# 清掉 extra KB
curl -s -X DELETE http://localhost:3001/knowledge-bases/$NEW_KB_ID
```

Expected: persona 挂载列表最终只剩 default KB。

- [ ] **Step 4: 单 KB 搜索 + persona 聚合搜索**

```bash
# 单 KB
curl -s -X POST http://localhost:3001/knowledge-bases/$DEFAULT_KB/search \
  -H 'content-type: application/json' \
  -d '{"query":"面试速通","rerank":false,"finalTopK":3}' | python3 -c "import json,sys;d=json.load(sys.stdin);print('stage1:',len(d['stage1']),'stage2:',len(d['stage2']))"

# persona 聚合
curl -s -X POST http://localhost:3001/personas/$PERSONA_ID/search \
  -H 'content-type: application/json' \
  -d '{"query":"面试速通"}' | python3 -c "import json,sys;d=json.load(sys.stdin);print('results:',len(d['results']))"
```

Expected: 两路都返回 > 0 个结果。

- [ ] **Step 5: Chunk 启用/禁用**

```bash
# 拿第一个 document 的 chunks
DOC_ID=$(curl -s http://localhost:3001/knowledge-bases/$DEFAULT_KB/documents | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
CHUNKS=$(curl -s http://localhost:3001/knowledge-bases/$DEFAULT_KB/documents/$DOC_ID/chunks)
echo "$CHUNKS" | python3 -c "import json,sys;d=json.load(sys.stdin);print('chunks:',len(d),'sample:',d[0]['chunkIndex'],d[0]['enabled'])"

FIRST_CHUNK_ID=$(echo "$CHUNKS" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

# 禁用 chunk 0
curl -s -X PATCH http://localhost:3001/knowledge-bases/$DEFAULT_KB/chunks/$FIRST_CHUNK_ID \
  -H 'content-type: application/json' -d '{"enabled":false}'

# 再搜，应该看不到 chunk_index=0
curl -s -X POST http://localhost:3001/knowledge-bases/$DEFAULT_KB/search \
  -H 'content-type: application/json' \
  -d '{"query":"提示词模板","rerank":false,"finalTopK":5}' | python3 -c "
import json,sys
d=json.load(sys.stdin)
indices=[c['chunk_index'] for c in d['stage1']]
print('stage1 chunk_indices:', indices, 'contains_0:', 0 in indices)
"

# 再启用
curl -s -X PATCH http://localhost:3001/knowledge-bases/$DEFAULT_KB/chunks/$FIRST_CHUNK_ID \
  -H 'content-type: application/json' -d '{"enabled":true}'
```

Expected: 禁用后 stage1 不再出现 `chunk_index=0`；启用后恢复。

- [ ] **Step 6: /chat 端到端**

```bash
curl -s -N -X POST http://localhost:3001/chat \
  -H 'content-type: application/json' \
  -d "{\"personaId\":\"$PERSONA_ID\",\"message\":\"这个提示词模板是做什么用的？\"}" \
  --max-time 30 2>&1 | head -6
```

Expected: 看到 `message-metadata` 含 citations，且 `text-delta` 事件正常返回 token。

- [ ] **Step 7: 停 server + tag**

```bash
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null
lsof -iTCP:3001 -sTCP:LISTEN -n -P && echo "WARNING still running" || echo "stopped"

cd /Users/wei.he/Documents/GitHub/ai-agent-course-code
git tag kb-phase2-done
git log --oneline kb-phase1-done..kb-phase2-done
```

Expected: 看到 8 个左右的新 commit（Task 1-8 各一个左右）。

---

## 验收清单（Phase 2 完成条件）

- [ ] 新路由全部可用：
  - `GET/POST /knowledge-bases`
  - `GET/PATCH/DELETE /knowledge-bases/:kbId`
  - `GET/POST/DELETE /knowledge-bases/:kbId/documents`
  - `GET /knowledge-bases/:kbId/documents/:docId/chunks`
  - `PATCH /knowledge-bases/:kbId/chunks/:chunkId`
  - `POST /knowledge-bases/:kbId/search`
  - `GET/POST /personas/:personaId/knowledge-bases`
  - `DELETE /personas/:personaId/knowledge-bases/:kbId`
  - `POST /personas/:personaId/search`
- [ ] 老路由 `/knowledge/:personaId/*` 全部 404
- [ ] `match_knowledge_legacy` RPC 已消失；只剩 `match_knowledge(vector, uuid, float, int)` 单签名
- [ ] `/chat` 端到端通过，citations 正常
- [ ] Chunk 禁用后检索 SQL 不再命中；启用后恢复
- [ ] `AgentService.run` 调用的是 `retrieveForPersona`
- [ ] `KnowledgeService` 里不再有 persona_id 参数的 retrieve/retrieveWithStages/listDocuments/ingestDocument
- [ ] Swagger 文档 http://localhost:3001/api/docs 里 `knowledge-bases` 和 `persona-knowledge-bases` tag 都能看到
- [ ] `git tag kb-phase2-done` 已打

---

## Phase 2 故意**不做**的事

- 不动前端（前端迁移在 Phase 3）
- 不引入 vue-router
- 不做 chunk 内容编辑、手动新增 chunk、重新切分
- 不做 URL 爬取、FAQ 直录
- 不做多 LLM 供应商管理
- 不做审计日志

---

## 下一阶段

Phase 2 完成 + tag `kb-phase2-done` 之后，运行 `superpowers:writing-plans` 生成：

`docs/superpowers/plans/2026-04-17-kb-phase-3-frontend-workspace.md`

Phase 3 的目标：引入 vue-router、`App.vue` 改为 shell、`/kb` 列表页、`/kb/:kbId` 详情三 Tab（Documents / HitTest / Settings）、`useKnowledgeBase` hook。
